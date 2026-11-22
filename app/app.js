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
  li.querySelector('button').addEventListener('click', () => onAck(i.id, li));
  return li;
}

function markAcked(li, reply) {
  const at = reply?.ackedAt ? formatLocal(reply.ackedAt) : '';
  li.classList.add('is-acked');
  li.querySelector('.act').innerHTML = `<span data-testid="acked" class="acked" title="${esc(reply?.ackedAt ?? '')}">✓ acked ${esc(at)}</span>`;
}

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

/** Puts the current incidents on screen, newest first; new ones go on top, existing rows stay put. */
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const seen = new Set();
  let prev = null;
  for (const i of sorted) {
    seen.add(i.id);
    let li = rows.get(i.id);
    if (!li) {
      li = buildRow(i);
      rows.set(i.id, li);
    }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (li !== want) list.insertBefore(li, want);
    prev = li;
  }
  for (const [id, li] of rows) {
    if (!seen.has(id)) {
      li.remove();
      rows.delete(id);
    }
  }
  empty.hidden = sorted.length > 0;
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
