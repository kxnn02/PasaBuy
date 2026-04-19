import { fromStroops, shortAddr, getStatusKey, EXPLORER } from './utils.js';

// ═══ TOASTS ═══

export function toast(msg, type = 'info', txHash = null) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const link = txHash
    ? `<br><a style="color:var(--accent);font-size:0.8rem" href="${EXPLORER}/tx/${txHash}" target="_blank">View tx →</a>`
    : '';
  el.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span>${msg}${link}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 250);
  }, 5000);
}

// ═══ CONFIRM MODAL ═══

export function confirmModal(icon, title, body) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-icon').textContent = icon;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent = body;
    overlay.classList.add('open');

    function cleanup() { overlay.classList.remove('open'); off(); }
    function off() {
      document.getElementById('modal-confirm').removeEventListener('click', yes);
      document.getElementById('modal-cancel').removeEventListener('click', no);
    }
    function yes() { cleanup(); resolve(true); }
    function no() { cleanup(); resolve(false); }

    document.getElementById('modal-confirm').addEventListener('click', yes);
    document.getElementById('modal-cancel').addEventListener('click', no);
  });
}

// ═══ BUTTON LOADING ═══

export function setLoading(btn, on, text = 'Working…') {
  if (!btn) return;
  if (on) {
    btn._orig = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${text}`;
    btn.disabled = true;
  } else {
    if (btn._orig) btn.innerHTML = btn._orig;
    btn.disabled = false;
  }
}

// ═══ ORDER CARD RENDERING ═══

export function renderOrderCard(order, role) {
  const status = getStatusKey(order);
  const badge = `badge badge-${status.toLowerCase()}`;
  const amount = order.amount != null ? fromStroops(order.amount) : '0';
  const fee = order.service_fee != null ? fromStroops(order.service_fee) : '0';
  const item = order.item_description || '—';
  const buyer = order.buyer || '—';
  const agent = order.agent || null;
  const id = Number(order.id);

  let actions = '';
  if (role === 'agent') {
    if (status === 'Open') actions = `<button class="btn btn-primary btn-sm" data-action="accept" data-id="${id}">Accept Order</button>`;
    if (status === 'Accepted') actions = `<button class="btn btn-secondary btn-sm" data-action="ship" data-id="${id}">📦 Mark Shipped</button>`;
  }
  if (role === 'buyer') {
    if (status === 'Shipped') {
      actions = `<button class="btn btn-success btn-sm" data-action="confirm" data-id="${id}">✅ Confirm</button>
                 <button class="btn btn-danger btn-sm" data-action="dispute" data-id="${id}">⚠ Dispute</button>`;
    }
    if (status === 'Accepted') {
      actions = `<button class="btn btn-danger btn-sm" data-action="dispute" data-id="${id}">⚠ Dispute</button>`;
    }
  }

  return `
    <div class="order-card">
      <div class="order-top">
        <div>
          <div class="order-id">Order #${id}</div>
          <div class="order-name">${item}</div>
        </div>
        <div class="order-amount">
          <div class="xlm">${amount} XLM</div>
          <div class="fee">Fee: ${fee} XLM</div>
        </div>
      </div>
      <div class="order-addrs">
        <span><span class="label">Buyer</span>${shortAddr(buyer)}</span>
        ${agent ? `<span><span class="label">Agent</span>${shortAddr(agent)}</span>` : ''}
      </div>
      <div class="order-footer">
        <span class="${badge}">${status}</span>
        <div class="order-actions">${actions}</div>
      </div>
    </div>`;
}

export function renderEmpty(containerId, msg) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="empty">${msg}</div>`;
}

export function renderLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
}
