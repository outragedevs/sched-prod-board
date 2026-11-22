import { fetchIncidents, ack } from './api.js';
import { formatLocal } from './time.js';

const REFRESH_MS = 2000;

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const errorBox = board.querySelector('.error');

// Rows are kept by incident id so a refresh never rebuilds a row (and never drops a click on it).
const rows = new Map();
const acked = new Set();

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function buildRow(i) {
  const li = document.createElement('li');
  li.setAttribute('data-testid', 'incident-row');
  li.dataset.id = i.id;
  li.className = `row ${esc(i.severity)}`;
  li.innerHTML = `
    <span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(formatLocal(i.openedAt))}</time>
    <span class="act"><button type="button" data-testid="ack">Ack</button></span>`;
  li.querySelector('button').addEventListener('click', () => askAck(i, li));
  return li;
}

function markAcked(li, reply) {
  const at = reply?.ackedAt ? formatLocal(reply.ackedAt) : '';
  li.classList.add('is-acked');
  li.querySelector('.act').innerHTML = `<span data-testid="acked" class="acked" title="${esc(reply?.ackedAt ?? '')}">✓ acked ${esc(at)}</span>`;
}

// Ack asks first and names the incident, so a row that moved under the pointer is caught before it is acked.
const confirmBox = document.querySelector('[data-testid="confirm"]');
const confirmText = confirmBox.querySelector('.confirm-text');
const confirmAck = confirmBox.querySelector('[data-testid="confirm-ack"]');
const confirmCancel = confirmBox.querySelector('[data-testid="confirm-cancel"]');
let pending = null;

function askAck(i, li) {
  if (acked.has(i.id)) return;
  pending = { id: i.id, li };
  confirmText.innerHTML = `Ack <strong class="confirm-id">${esc(i.id)}</strong>?<br /><span class="confirm-what">${esc(i.severity)} · ${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>`;
  confirmBox.hidden = false;
  confirmAck.focus();
}

function closeConfirm() {
  const was = pending;
  pending = null;
  confirmBox.hidden = true;
  was?.li.querySelector('[data-testid="ack"]')?.focus();
}

confirmAck.addEventListener('click', () => {
  if (!pending) return;
  const { id, li } = pending;
  pending = null;
  confirmBox.hidden = true;
  onAck(id, li);
});
confirmCancel.addEventListener('click', closeConfirm);
confirmBox.addEventListener('click', (e) => {
  if (e.target === confirmBox) closeConfirm();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pending) closeConfirm();
});

async function onAck(id, li) {
  if (acked.has(id)) return;
  const btn = li.querySelector('[data-testid="ack"]');
  btn.disabled = true;
  btn.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.add(id);
    markAcked(li, reply);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Ack';
    showError(`Ack failed for ${id}: ${err.message}`);
  }
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
}

/**
 * Merges an answer into the board: new incidents go in at their place by time (newest first), rows already
 * on the board are never moved or taken off, so an empty or partial answer cannot blank the board.
 */
function render(incidents) {
  const fresh = incidents.filter((i) => !rows.has(i.id));
  fresh.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt)); // oldest first, each lands above older rows
  for (const i of fresh) {
    const li = buildRow(i);
    li.dataset.openedAt = String(Date.parse(i.openedAt));
    const t = Number(li.dataset.openedAt);
    const before = [...list.children].find((el) => Number(el.dataset.openedAt) < t) ?? null;
    list.insertBefore(li, before);
    rows.set(i.id, li);
  }
  empty.hidden = rows.size > 0;
}

let loaded = false;
async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents ?? []);
    showError('');
    if (!loaded) {
      loaded = true;
      loader.remove();
      board.removeAttribute('aria-busy');
    }
  } catch (err) {
    showError(`Could not load incidents: ${err.message}. Retrying…`);
  } finally {
    // Chain instead of setInterval so a slow answer never overlaps the next request.
    setTimeout(refresh, REFRESH_MS);
  }
}

refresh();
