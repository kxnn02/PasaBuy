import * as StellarSdk from '@stellar/stellar-sdk';
import { signTx, getPublicKey } from './wallet.js';
import { TESTNET_PASSPHRASE, TESTNET_RPC, CONTRACT_ID_KEY, RPC_URL_KEY } from './utils.js';

const { rpc, TransactionBuilder, Contract, Address, nativeToScVal, scValToNative, Keypair, Account, BASE_FEE, Transaction } = StellarSdk;

// ═══ SERVER / CONFIG ═══

function getRpcUrl() {
  return localStorage.getItem(RPC_URL_KEY) || TESTNET_RPC;
}

function getContractId() {
  return localStorage.getItem(CONTRACT_ID_KEY) || '';
}

function getServer() {
  return new rpc.Server(getRpcUrl(), { allowHttp: false });
}

// ═══ INVOKE (write — requires Freighter signature) ═══

export async function invokeContract(functionName, args = []) {
  const pubKey = getPublicKey();
  if (!pubKey) throw new Error('Wallet not connected');
  const contractId = getContractId();
  if (!contractId) throw new Error('Contract ID not configured');

  const server = getServer();
  const account = await server.getAccount(pubKey);
  const contract = new Contract(contractId);
  const op = contract.call(functionName, ...args);

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  // Prepare transaction (simulates and attaches resources)
  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (e) {
    throw new Error('Simulation failed: ' + e.message);
  }

  // Sign via Freighter
  const signedXdr = await signTx(prepared.toXDR(), TESTNET_PASSPHRASE);

  // Parse signed transaction and submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
  const submitResult = await server.sendTransaction(parsedTx);

  if (submitResult.status === 'ERROR') {
    throw new Error('Transaction failed: ' + JSON.stringify(submitResult.errorResult));
  }

  // Poll for confirmation
  const txHash = submitResult.hash;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const status = await server.getTransaction(txHash);
    if (status.status === 'SUCCESS') return txHash;
    if (status.status === 'FAILED') {
      throw new Error('Transaction failed on-chain');
    }
  }
  throw new Error('Transaction confirmation timed out');
}

// ═══ VIEW (read-only — no signature needed) ═══

export async function viewContract(functionName, args = []) {
  const contractId = getContractId();
  if (!contractId) throw new Error('Contract ID not configured');

  const server = getServer();
  const sourceKey = getPublicKey() || Keypair.random().publicKey();
  const account = new Account(sourceKey, '0');
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error('Simulation failed: ' + (sim.error || 'unknown'));
  }

  const retVal = sim.result?.retval;
  if (!retVal) return null;
  return scValToNative(retVal);
}

// ═══ HIGH-LEVEL API ═══

export async function fetchOrderCount() {
  const result = await viewContract('order_count');
  return Number(result);
}

export async function fetchOrder(orderId) {
  const order = await viewContract('get_order', [
    nativeToScVal(orderId, { type: 'u64' }),
  ]);
  return order;
}

export async function createOrder(itemName, amount, fee) {
  const pubKey = getPublicKey();
  return invokeContract('create_order', [
    Address.fromString(pubKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(fee, { type: 'i128' }),
    nativeToScVal(itemName, { type: 'symbol' }),
  ]);
}

export async function acceptOrder(orderId) {
  const pubKey = getPublicKey();
  return invokeContract('accept_order', [
    Address.fromString(pubKey).toScVal(),
    nativeToScVal(orderId, { type: 'u64' }),
  ]);
}

export async function markShipped(orderId) {
  const pubKey = getPublicKey();
  return invokeContract('mark_shipped', [
    Address.fromString(pubKey).toScVal(),
    nativeToScVal(orderId, { type: 'u64' }),
  ]);
}

export async function confirmDelivery(orderId) {
  const pubKey = getPublicKey();
  return invokeContract('confirm_delivery', [
    Address.fromString(pubKey).toScVal(),
    nativeToScVal(orderId, { type: 'u64' }),
  ]);
}

export async function raiseDispute(orderId) {
  const pubKey = getPublicKey();
  return invokeContract('dispute', [
    Address.fromString(pubKey).toScVal(),
    nativeToScVal(orderId, { type: 'u64' }),
  ]);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
