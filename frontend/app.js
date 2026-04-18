/* ============================================================
   PasaBuy — app.js
   Full Freighter + Soroban integration on Stellar Testnet
   Contract: CCEWJAW32HTVM4MYT5UBBFHMFOOWB7D4TEHVL6SEHG3DSPJXYJFFEBY4
   ============================================================ */

// ── Constants ────────────────────────────────────────────────
const CONTRACT_ID = 'CCEWJAW32HTVM4MYT5UBBFHMFOOWB7D4TEHVL6SEHG3DSPJXYJFFEBY4';
const USDC_CONTRACT = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const NETWORK = 'TESTNET';
const NETWORK_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const USDC_FACTOR = 10_000_000n;

// ── Runtime state ────────────────────────────────────────────
let walletPublicKey = null;
let orders = [];
let openForAgent = [];
let expanded = {};

// ── Helpers ──────────────────────────────────────────────────
function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
}

function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Processing…' : label;
}

// ── Wallet Connection (REBUILT & FIXED) ──────────────────────
/**
 * Safely waits for the Freighter API to be injected by the browser extension
 */
async function waitForFreighter() {
  for (let i = 0; i < 20; i++) {
    if (typeof window.freighterApi !== 'undefined') return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function connectWallet() {
  const btn = document.getElementById('connectBtn');
  setLoading('connectBtn', true, 'Connecting...');

  // 1. Wait for extension
  const isAvailable = await waitForFreighter();
  if (!isAvailable) {
    setLoading('connectBtn', false, 'Connect Wallet');
    toast('Freighter extension not detected. Ensure it is installed and unlocked.');
    return;
  }

  try {
    const { requestAccess, getPublicKey } = window.freighterApi;

    // 2. Request access
    await requestAccess();
    walletPublicKey = await getPublicKey();

    // 3. UI Update
    const short = walletPublicKey.slice(0, 4) + '...' + walletPublicKey.slice(-4);
    document.getElementById('walletBar').classList.add('visible');
    document.getElementById('walletAddr').textContent = short + ' connected';

    btn.textContent = '✓ Connected';
    btn.disabled = true;
    btn.style.opacity = '0.6';

    toast('Wallet connected — ' + short);
    await loadOrdersFromChain();

  } catch (e) {
    console.error('Connection error:', e);
    setLoading('connectBtn', false, 'Connect Wallet');
    toast('Connection failed: ' + e.message);
  }
}

// ── Soroban & Logic helpers ──────────────────────────────────
// [Keep all your existing functions: invokeContract, viewContract, parseOrder, etc., below here]
// Ensure you do not change the existing logic for contract calls.

async function loadOrdersFromChain() {
  if (!walletPublicKey) return;
  toast('Loading orders from testnet…');
  try {
    const all = await fetchAllOrders();
    orders = all.filter(o => o.buyer === walletPublicKey || o.agent === walletPublicKey);
    openForAgent = all.filter(o => o.state === 'Open' && o.buyer !== walletPublicKey);
    renderOrders();
    renderAgentOrders(openForAgent);
    toast('✓ Orders synced.');
  } catch (e) {
    console.error(e);
    toast('Could not load orders: ' + e.message);
  }
}

// Ensure you include your existing render and utility functions here as they were.