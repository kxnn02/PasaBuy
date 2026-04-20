import { isConnected, requestAccess, signTransaction, getNetworkDetails } from '@stellar/freighter-api';

let _publicKey = null;

/** Returns the connected public key, or null. */
export function getPublicKey() {
  return _publicKey;
}

/** Connect to Freighter and return the public key. */
export async function connectWallet() {
  const connected = await isConnected();
  if (!connected) throw new Error('Freighter extension not found. Please install it.');

  const accessObj = await requestAccess();
  if (accessObj.error) throw new Error(accessObj.error);

  const network = await getNetworkDetails();
  if (network && network.network !== 'TESTNET') {
    throw new Error('Please switch your Freighter wallet to Testnet.');
  }

  _publicKey = accessObj.address;
  return _publicKey;
}

/**
 * Sign a transaction XDR via Freighter.
 * Returns the signed XDR string.
 */
export async function signTx(xdr, networkPassphrase) {
  const result = await signTransaction(xdr, {
    network: 'TESTNET',
    networkPassphrase,
  });
  if (result.error) throw new Error('Signing rejected: ' + result.error);
  return result.signedTxXdr;
}
