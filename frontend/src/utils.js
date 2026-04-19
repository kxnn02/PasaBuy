// ═══ CONSTANTS ═══

export const CONTRACT_ID_KEY = 'pasabuy_contract_id';
export const RPC_URL_KEY = 'pasabuy_rpc_url';

export const NATIVE_XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const EXPLORER = 'https://stellar.expert/explorer/testnet';

// Soroban OrderStatus enum discriminant → readable name
export const STATUS_MAP = [
  'Open',       // 0
  'Accepted',   // 1
  'Shipped',    // 2
  'Completed',  // 3
  'Disputed',   // 4
  'Resolved',   // 5
  'Cancelled',  // 6
];

// ═══ XLM CONVERSIONS ═══
// All math is string-based BigInt to avoid floating-point precision errors.

const STROOPS = 10_000_000n; // 1 XLM = 10^7 stroops

/** Converts a human-readable XLM string (e.g. "12.5") to stroops (BigInt). */
export function toStroops(xlm) {
  const str = String(xlm).trim();
  const dot = str.indexOf('.');
  if (dot === -1) return BigInt(str) * STROOPS;
  const int = str.slice(0, dot);
  const frac = str.slice(dot + 1).slice(0, 7).padEnd(7, '0');
  return BigInt(int || '0') * STROOPS + BigInt(frac);
}

/** Converts stroops (BigInt or number) to a human-readable XLM string. */
export function fromStroops(stroops) {
  const bi = BigInt(stroops);
  const sign = bi < 0n ? '-' : '';
  const abs = bi < 0n ? -bi : bi;
  const int = abs / STROOPS;
  const frac = abs % STROOPS;
  return `${sign}${int}.${frac.toString().padStart(7, '0').replace(/0+$/, '') || '0'}`;
}

/** Shortens a Stellar address: "GABCD...WXYZ" */
export function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || '—';
  return addr.slice(0, 5) + '…' + addr.slice(-4);
}

/**
 * Maps an order's status field (which can be a u32 discriminant, a string, or an object)
 * to a readable status name.
 */
export function getStatusKey(order) {
  if (!order || order.status == null) return 'Open';
  const s = order.status;
  
  // If it's an array (which is how scValToNative parses enums like scvVec([scvSymbol('Open')]))
  if (Array.isArray(s) && s.length > 0) return s[0];
  
  if (typeof s === 'number') return STATUS_MAP[s] || 'Open';
  if (typeof s === 'string' && /^\d+$/.test(s)) return STATUS_MAP[parseInt(s)] || 'Open';
  if (typeof s === 'string') return s;
  
  // Object like { "Open": null }
  if (typeof s === 'object') {
    const keys = Object.keys(s);
    return keys.length > 0 ? keys[0] : 'Open';
  }
  return 'Open';
}
