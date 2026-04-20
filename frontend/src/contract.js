import * as StellarSdk from '@stellar/stellar-sdk';
import { signTx, getPublicKey } from './wallet.js';
import { TESTNET_PASSPHRASE, TESTNET_RPC, CONTRACT_ID_KEY, RPC_URL_KEY, DEFAULT_CONTRACT_ID } from './utils.js';

const { rpc, TransactionBuilder, Contract, Address, nativeToScVal, scValToNative, Keypair, Account, BASE_FEE, Transaction } = StellarSdk;

// ═══ SERVER / CONFIG ═══

function getRpcUrl() {
  return localStorage.getItem(RPC_URL_KEY) || TESTNET_RPC;
}

function getContractId() {
  return localStorage.getItem(CONTRACT_ID_KEY) || DEFAULT_CONTRACT_ID;
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
  let account;
  
  // 1. Unfunded Account handling & Auto-fund
  try {
    account = await server.getAccount(pubKey);
  } catch (e) {
    if (e?.response?.status === 404 || (e.message && e.message.includes('not found'))) {
      try {
        await fetch('https://friendbot.stellar.org/?addr=' + pubKey);
        await sleep(3000); // wait for ledger close
        account = await server.getAccount(pubKey);
      } catch (fundErr) {
        throw new Error('Your account is unfunded. Please use Friendbot on the Stellar Laboratory to fund it.');
      }
    } else {
      throw new Error('Network error: Could not connect to Stellar Testnet.');
    }
  }

  const contract = new Contract(contractId);
  const op = contract.call(functionName, ...args);

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  // 2. Simulation panics
  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (e) {
    const msg = String(e.message || e);
    // Parse known smart contract panics
    const knownPanics = ['invalid amount', 'order is not', 'not in accepted state', 'caller is not', 'cannot dispute'];
    const foundPanic = knownPanics.find(p => msg.includes(p));
    
    if (foundPanic) throw new Error(`Smart Contract Blocked Action: ${foundPanic}`);
    throw new Error('Simulation failed: ' + msg.substring(0, 100));
  }

  // 3. User rejects signature
  const signedXdr = await signTx(prepared.toXDR(), TESTNET_PASSPHRASE);

  // 4. Submission & Balance errors
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
  let submitResult;
  try {
    submitResult = await server.sendTransaction(parsedTx);
  } catch (e) {
    throw new Error('Network error during transaction submission.');
  }

  if (submitResult.status === 'ERROR') {
    const errStr = JSON.stringify(submitResult.errorResult);
    if (errStr.includes('op_underfunded') || errStr.includes('tx_insufficient_balance')) {
      throw new Error('Insufficient XLM balance to complete this transaction.');
    }
    throw new Error('Transaction failed on-chain.');
  }

  // Poll for confirmation
  const txHash = submitResult.hash;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const status = await server.getTransaction(txHash);
    if (status.status === 'SUCCESS') return txHash;
    if (status.status === 'FAILED') {
      const errStr = JSON.stringify(status.resultXdr);
      if (errStr.includes('underfunded')) throw new Error('Insufficient XLM balance.');
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
