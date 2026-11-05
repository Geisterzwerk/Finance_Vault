// =====================================================================
// app.js – Start, Sperrbildschirm, Navigation, Kurse, Meilensteine
// =====================================================================
import { isSetUp, setup, unlock, lock, isUnlocked } from './vault.js';
import { S, setState, emptyState, defaultGoals, commit, onChange, flush } from './store.js';
import { holdings, checkMilestones } from './calc.js';
import { refreshPrices } from './prices.js';
import { $, toast, closeAll, refreshSheet, sheetOpen, closeSheet } from './ui.js';
import { dashboard, invest, goals, celebrate } from './views-main.js';
import { taxes, invoices, vault, ui as taxUi } from './views-more.js';

const ROUTES = { '': dashboard, invest, ziele: goals, steuern: taxes, rechnungen: invoices, vault };
const TAB = { '': 0, ziele: 0, invest: 1, steuern: 2, rechnungen: 3, vault: 4 };
const route = () => { const [a, b] = location.hash.replace(/^#\/?/, '').split('/'); return { a: a || '', b }; };

function render() {
  if (!isUnlocked()) return;
  const { a, b } = route();
  const page = (ROUTES[a] || dashboard)(b);
  $('#title').innerHTML = page.title;
  $('#sub').innerHTML = page.sub || '';
  $('#back').hidden = !(a === 'ziele' || (a === 'vault' && b));
  const inner = document.createElement('div'); inner.innerHTML = page.html;
  $('#view').replaceChildren(inner);
  page.bind && page.bind(inner);
  document.querySelectorAll('.tabbar a').forEach((x, i) => x.classList.toggle('sel', i === (TAB[a] ?? 0)));
}

// ---------- Kurse + Meilensteine ----------
async function updatePrices(manual = false) {
  const h = holdings();
  const r = await refreshPrices(Object.keys(h).filter((k) => h[k].qty > 1e-8));
  if (manual) toast(r.ok ? 'Kurse aktualisiert' : r.reason === 'offline' ? 'Offline – letzter Stand bleibt' : 'Kurse nicht erreichbar');
  milestones();
}
function milestones() {
  const fresh = checkMilestones();
  if (fresh.length) { commit(); setTimeout(() => celebrate(fresh), 300); }
}

// ---------- Sperrbildschirm ----------
async function showLock() {
  const first = !(await isSetUp());
  const el = $('#lock'); el.hidden = false;
  el.innerHTML = `<div class="lockbox">
    <div class="brand">FINANCE VAULT</div><div class="serif lockt">${first ? 'Willkommen' : 'Entsperren'}</div>
    <div class="small mut">${first ? 'Lege einen PIN fest (mind. 6 Zeichen). Er verschlüsselt alle Daten auf diesem Gerät. Ohne PIN gibt es keinen Zugriff, auch nicht für dich. Notiere ihn sicher.' : 'Deine Daten sind verschlüsselt.'}</div>
    <input id="pin" type="password" inputmode="numeric" autocomplete="${first ? 'new-password' : 'current-password'}" placeholder="PIN">
    ${first ? '<input id="pin2" type="password" inputmode="numeric" autocomplete="new-password" placeholder="PIN wiederholen">' : ''}
    <button class="btn gold block big" id="go">${first ? 'Vault erstellen' : 'Entsperren'}</button>
    <div class="small" id="msg"></div></div>`;
  const pin = $('#pin'); setTimeout(() => pin.focus(), 100);
  const go = async () => {
    const msg = $('#msg');
    if (first) {
      if (pin.value.length < 6) return (msg.textContent = 'Mindestens 6 Zeichen');
      if (pin.value !== $('#pin2').value) return (msg.textContent = 'PINs stimmen nicht überein');
      msg.textContent = 'Verschlüssele …';
      const st = emptyState(); st.goals = defaultGoals(st);
      await setup(pin.value, st); setState(st);
    } else {
      msg.textContent = 'Prüfe …';
      const st = await unlock(pin.value);
      if (!st) { msg.textContent = 'Falscher PIN'; pin.value = ''; pin.focus(); return; }
      setState(st);
    }
    el.hidden = true; el.innerHTML = '';
    start();
  };
  $('#go').addEventListener('click', go);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

let started = false;
function start() {
  render();
  if (!started) { started = true; setInterval(() => { if (isUnlocked() && !document.hidden) updatePrices(); }, 5 * 60e3); }
  updatePrices();
}

// ---------- Automatisch sperren ----------
let hiddenAt = null;
document.addEventListener('visibilitychange', async () => {
  if (!isUnlocked()) return;
  if (document.hidden) { hiddenAt = Date.now(); await flush().catch(() => {}); }
  else if (hiddenAt && Date.now() - hiddenAt > (S().settings.autoLockMin || 5) * 60e3) { lock(); closeAll(); $('#view').innerHTML = ''; showLock(); }
  else updatePrices();
});
addEventListener('online', () => isUnlocked() && updatePrices());

// ---------- Events ----------
addEventListener('hashchange', () => { closeAll(); render(); scrollTo(0, 0); });
addEventListener('rerender', render);
addEventListener('refreshprices', () => updatePrices(true));
onChange(() => { render(); refreshSheet(); });
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); if (sheetOpen()) closeAll(); location.hash = g.dataset.go; }
});
$('#back').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
$('#sheet-back').addEventListener('click', closeSheet);
$('#sheet-bg').addEventListener('click', closeAll);
$('#refresh').addEventListener('click', () => updatePrices(true));
$('#sub').addEventListener('click', (e) => { const yb = e.target.closest('[data-y]'); if (yb) { taxUi.taxYear += +yb.dataset.y; render(); } });

showLock();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
