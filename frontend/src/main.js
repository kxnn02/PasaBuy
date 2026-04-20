import './style.css';
import { connectWallet, getPublicKey } from './wallet.js';
import * as api from './contract.js';
import { toast, confirmModal, setLoading, renderOrderCard, renderEmpty, renderLoading } from './ui.js';
import { toStroops, fromStroops, shortAddr, getStatusKey, CONTRACT_ID_KEY, RPC_URL_KEY, TESTNET_RPC, DEFAULT_CONTRACT_ID } from './utils.js';

// ═══ STATE ═══

function contractId() { return localStorage.getItem(CONTRACT_ID_KEY) || DEFAULT_CONTRACT_ID; }

// ═══ STATUS BAR ═══

function updateStatus() {
  const cid = contractId();
  const pub = getPublicKey();

  const cDot = document.getElementById('contract-dot');
  const cDisp = document.getElementById('contract-display');
  const wDot = document.getElementById('wallet-dot');
  const wDisp = document.getElementById('wallet-display');

  if (cid) { cDot.classList.add('dot-active'); cDisp.textContent = shortAddr(cid); }
  else { cDot.classList.remove('dot-active'); cDisp.textContent = 'Not set'; }

  if (pub) { wDot.classList.add('dot-active'); wDisp.textContent = shortAddr(pub); }
  else { wDot.classList.remove('dot-active'); wDisp.textContent = 'Disconnected'; }
}

// ═══ WALLET ═══

async function handleConnect() {
  const btn = document.getElementById('wallet-btn');
  setLoading(btn, true, 'Connecting…');
  try {
    const addr = await connectWallet();
    btn.textContent = shortAddr(addr);
    toast('Wallet connected!', 'success');
    updateStatus();
    // Reload current tab data
    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    if (activeTab === 'buyer') loadBuyerOrders();
    if (activeTab === 'agent') { loadOpenOrders(); loadAgentOrders(); }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setLoading(btn, false);
    const pub = getPublicKey();
    if (pub) btn.textContent = shortAddr(pub);
  }
}

// ═══ CONFIG DRAWER ═══

function openConfig() {
  document.getElementById('config-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('config-contract').value = contractId();
  document.getElementById('config-rpc').value = localStorage.getItem(RPC_URL_KEY) || TESTNET_RPC;
}

function closeConfig() {
  document.getElementById('config-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

function saveConfig() {
  const cid = document.getElementById('config-contract').value.trim();
  const rpcUrl = document.getElementById('config-rpc').value.trim();
  if (cid) localStorage.setItem(CONTRACT_ID_KEY, cid);
  if (rpcUrl) localStorage.setItem(RPC_URL_KEY, rpcUrl);
  updateStatus();
  closeConfig();
  toast('Settings saved!', 'success');
}

// ═══ TAB SWITCHING ═══

function switchTab(name) {
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');

  if (name === 'buyer' && getPublicKey()) loadBuyerOrders();
  if (name === 'agent') {
    loadOpenOrders();
    if (getPublicKey()) loadAgentOrders();
  }
}

// ═══ CREATE ORDER ═══

async function handleCreateOrder() {
  if (!getPublicKey()) { toast('Connect your wallet first.', 'error'); return; }
  if (!contractId()) { toast('Set Contract ID in settings.', 'error'); return; }

  const name = document.getElementById('item-name').value.trim();
  const amountStr = document.getElementById('order-amount').value;
  const feeStr = document.getElementById('order-fee').value;

  if (!name) { toast('Enter an item name.', 'error'); return; }
  if (!amountStr || parseFloat(amountStr) <= 0) { toast('Enter a valid amount.', 'error'); return; }
  if (!feeStr || parseFloat(feeStr) < 0) { toast('Enter a valid fee.', 'error'); return; }

  const amount = toStroops(amountStr);
  const fee = toStroops(feeStr);
  if (fee >= amount) { toast('Fee must be less than total amount.', 'error'); return; }

  const ok = await confirmModal('🔒', 'Lock funds?', `You are locking ${amountStr} XLM in escrow for "${name}".`);
  if (!ok) return;

  const btn = document.getElementById('create-btn');
  setLoading(btn, true, 'Posting order…');
  try {
    const txHash = await api.createOrder(name, amount, fee);
    toast(`Order created!`, 'success', txHash);
    document.getElementById('item-name').value = '';
    document.getElementById('order-amount').value = '';
    document.getElementById('order-fee').value = '';
    document.getElementById('fee-preview').style.display = 'none';
    loadBuyerOrders();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

// ═══ ORDER ACTIONS (delegated) ═══

async function handleOrderAction(action, orderId, btn) {
  if (!getPublicKey()) { toast('Connect your wallet first.', 'error'); return; }

  if (action === 'accept') {
    const ok = await confirmModal('🤝', 'Accept this order?', `You will be assigned as the agent for Order #${orderId}.`);
    if (!ok) return;
    setLoading(btn, true, 'Accepting…');
    try {
      const tx = await api.acceptOrder(orderId);
      toast(`Order #${orderId} accepted!`, 'success', tx);
      loadOpenOrders();
      loadAgentOrders();
    } catch (e) { toast('Accept failed: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  }

  if (action === 'ship') {
    setLoading(btn, true, 'Updating…');
    try {
      const tx = await api.markShipped(orderId);
      toast(`Order #${orderId} marked as shipped!`, 'success', tx);
      loadAgentOrders();
    } catch (e) { toast('Ship failed: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  }

  if (action === 'confirm') {
    const ok = await confirmModal('✅', 'Confirm delivery?', `This will release the XLM to the agent. Irreversible.`);
    if (!ok) return;
    setLoading(btn, true, 'Confirming…');
    try {
      const tx = await api.confirmDelivery(orderId);
      toast(`Delivery confirmed! Agent paid.`, 'success', tx);
      loadBuyerOrders();
    } catch (e) { toast('Confirm failed: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  }

  if (action === 'dispute') {
    const ok = await confirmModal('⚠️', 'Raise dispute?', `Funds will be frozen until an admin resolves it.`);
    if (!ok) return;
    setLoading(btn, true, 'Filing…');
    try {
      const tx = await api.raiseDispute(orderId);
      toast(`Dispute filed for Order #${orderId}.`, 'info', tx);
      loadBuyerOrders();
    } catch (e) { toast('Dispute failed: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  }
}

// ═══ LOAD ORDERS ═══

async function loadBuyerOrders() {
  if (!getPublicKey() || !contractId()) {
    renderEmpty('buyer-orders', 'Connect wallet & set Contract ID.');
    return;
  }
  renderLoading('buyer-orders');
  try {
    const count = await api.fetchOrderCount();
    if (count === 0) { renderEmpty('buyer-orders', 'No orders yet. Post your first pasabuy!', 'How it works: 1. Create an order 2. Lock your XLM 3. An agent buys it 4. Confirm delivery to release funds.'); return; }

    const orders = [];
    for (let i = 1; i <= count; i++) {
      try {
        const o = await api.fetchOrder(i);
        if (o && o.buyer === getPublicKey()) orders.push(o);
      } catch (_) {}
    }
    if (orders.length === 0) { renderEmpty('buyer-orders', 'No orders as buyer yet.', 'How it works: 1. Create an order 2. Lock your XLM 3. An agent buys it 4. Confirm delivery to release funds.'); return; }
    document.getElementById('buyer-orders').innerHTML = orders.reverse().map(o => renderOrderCard(o, 'buyer')).join('');
  } catch (e) {
    renderEmpty('buyer-orders', 'Failed: ' + e.message);
  }
}

async function loadOpenOrders() {
  if (!contractId()) { renderEmpty('open-orders', 'Set Contract ID in settings.'); return; }
  renderLoading('open-orders');
  try {
    const count = await api.fetchOrderCount();
    if (count === 0) { renderEmpty('open-orders', 'No orders posted yet.', 'Wait for a buyer to post a request!'); return; }

    const orders = [];
    for (let i = 1; i <= count; i++) {
      try {
        const o = await api.fetchOrder(i);
        if (o && getStatusKey(o) === 'Open') orders.push(o);
      } catch (_) {}
    }
    if (orders.length === 0) { renderEmpty('open-orders', 'No open orders right now.', 'Wait for a buyer to post a request!'); return; }
    document.getElementById('open-orders').innerHTML = orders.reverse().map(o => renderOrderCard(o, 'agent')).join('');
  } catch (e) {
    renderEmpty('open-orders', 'Failed: ' + e.message);
  }
}

async function loadAgentOrders() {
  if (!getPublicKey() || !contractId()) {
    renderEmpty('agent-orders', 'Connect wallet & set Contract ID.');
    return;
  }
  renderLoading('agent-orders');
  try {
    const count = await api.fetchOrderCount();
    if (count === 0) { renderEmpty('agent-orders', 'No orders exist.'); return; }

    const orders = [];
    for (let i = 1; i <= count; i++) {
      try {
        const o = await api.fetchOrder(i);
        if (o && o.agent === getPublicKey()) orders.push(o);
      } catch (_) {}
    }
    if (orders.length === 0) { renderEmpty('agent-orders', 'No assignments. Accept one above!'); return; }
    document.getElementById('agent-orders').innerHTML = orders.reverse().map(o => renderOrderCard(o, 'agent')).join('');
  } catch (e) {
    renderEmpty('agent-orders', 'Failed: ' + e.message);
  }
}

async function handleLookup() {
  if (!contractId()) { toast('Set Contract ID first.', 'error'); return; }
  const id = parseInt(document.getElementById('lookup-id').value);
  if (!id || id < 1) { toast('Enter a valid order ID.', 'error'); return; }
  const btn = document.getElementById('lookup-btn');
  setLoading(btn, true, '…');
  try {
    const order = await api.fetchOrder(id);
    document.getElementById('lookup-result').innerHTML = renderOrderCard(order, 'agent');
  } catch (e) {
    toast('Order not found: ' + e.message, 'error');
    document.getElementById('lookup-result').innerHTML = '';
  } finally {
    setLoading(btn, false);
  }
}

// ═══ FEE PREVIEW ═══

function updateFeePreview() {
  const amountStr = document.getElementById('order-amount').value;
  const feeStr = document.getElementById('order-fee').value;
  const preview = document.getElementById('fee-preview');

  if (!amountStr) { preview.style.display = 'none'; return; }
  preview.style.display = 'block';

  const amount = parseFloat(amountStr) || 0;
  const fee = parseFloat(feeStr) || 0;
  const item = amount - fee;

  document.getElementById('preview-item').textContent = `${item.toFixed(2)} XLM`;
  document.getElementById('preview-fee').textContent = `${fee.toFixed(2)} XLM`;
  document.getElementById('preview-total').textContent = `${amount.toFixed(2)} XLM`;
}

// ═══ INIT ═══

document.addEventListener('DOMContentLoaded', () => {
  updateStatus();

  // Tab switching
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Wallet
  document.getElementById('wallet-btn').addEventListener('click', handleConnect);

  // Config
  document.getElementById('config-btn').addEventListener('click', openConfig);
  document.getElementById('config-close').addEventListener('click', closeConfig);
  document.getElementById('drawer-overlay').addEventListener('click', closeConfig);
  document.getElementById('config-save').addEventListener('click', saveConfig);

  // Create order
  const itemNameInput = document.getElementById('item-name');
  const itemNameCounter = document.getElementById('item-name-counter');
  itemNameInput.addEventListener('input', () => {
    itemNameCounter.textContent = `${itemNameInput.value.length}/9 chars`;
  });
  
  document.getElementById('create-btn').addEventListener('click', handleCreateOrder);
  document.getElementById('order-amount').addEventListener('input', updateFeePreview);
  document.getElementById('order-fee').addEventListener('input', updateFeePreview);

  // Order lookup
  document.getElementById('lookup-btn').addEventListener('click', handleLookup);
  document.getElementById('lookup-id').addEventListener('keydown', e => { if (e.key === 'Enter') handleLookup(); });

  // Refresh buttons
  document.getElementById('buyer-refresh').addEventListener('click', loadBuyerOrders);
  document.getElementById('open-refresh').addEventListener('click', loadOpenOrders);
  document.getElementById('agent-refresh').addEventListener('click', loadAgentOrders);

  // Delegated click handler for order action buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id);
    handleOrderAction(action, id, btn);
  });

  // Auto-load buyer orders if wallet was previously connected
  if (contractId()) {
    loadOpenOrders(); // Always try to show open orders
  }
});
