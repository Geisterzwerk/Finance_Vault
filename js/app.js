// =====================================================================
// app.js – Start, Sperrbildschirm, Navigation, Kurse, Meilensteine,
// automatisches Sperren, App-Updates
// =====================================================================
import { isSetUp, setup, unlock, lock, isUnlocked, lockoutRemaining, backupInfo, importBackup } from './vault.js';
import { S, setState, clearState, emptyState, defaultGoals, commit, onChange, flush } from './store.js';
import { holdings, checkMilestones } from './calc.js';
import * as SRV from './server.js';
import { refreshPrices } from './prices.js';
import { $, esc, toast, closeAll, closeSheet, refreshSheet, sheetOpen } from './ui.js';
import { dashboard, invest, goals, celebrate } from './views-main.js';
import { taxes, invoices, vault, ui as taxUi } from './views-more.js';
import { analyse } from './views-analyse.js';
import { takeSnapshot } from './perf.js';
import * as BK from './backup.js';

const ROUTES = { '': dashboard, invest, ziele: goals, steuern: taxes, rechnungen: invoices, vault, analyse };
const TAB = { '': 0, ziele: 0, analyse: 0, invest: 1, steuern: 2, rechnungen: 3, vault: 4 };
const route = () => { const [a, b] = location.hash.replace(/^#\/?/, '').split('/'); return { a: a || '', b }; };

function render() {
  if (!isUnlocked()) return;
  const { a, b } = route();
  const view = Object.hasOwn(ROUTES, a) ? ROUTES[a] : dashboard;
  let page;
  try { page = view(b); } catch (e) {
    console.error(e);
    page = { title: 'Fehler', html: `<div class="card"><b>Diese Ansicht konnte nicht angezeigt werden.</b><div class="small mut mt">${esc(e.message)}</div></div>` };
  }
  $('#title').innerHTML = page.title;
  $('#sub').innerHTML = page.sub || '';
  $('#back').hidden = !(a === 'ziele' || a === 'analyse' || (a === 'vault' && b));
  const inner = document.createElement('div'); inner.className = 'page'; inner.innerHTML = page.html;
  $('#view').replaceChildren(inner);
  if (page.bind) page.bind(inner);
  document.querySelectorAll('.tabbar a').forEach((x, i) => {
    const on = i === (TAB[a] ?? 0);
    x.classList.toggle('sel', on);
    if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
  });
}

// ---------- Kurse + Meilensteine ----------
// Mit Server: Kurse, Verläufe, Ledger und BingX kommen von dort (ein Abruf).
// Ohne Server oder wenn er nicht erreichbar ist: Kurse direkt von CoinGecko.
async function updatePrices(manual = false) {
  if (!isUnlocked()) return;
  if (SRV.isConfigured() && navigator.onLine) {
    const x = await SRV.syncAll({ quiet: true });
    if (x && isUnlocked()) setTimeout(() => isUnlocked() && BK.autoBackup().then((r) => r && !r.unchanged && render()), 3000);
    if (x && !x.legacy && Date.now() - new Date(S().pricesAt || 0) < 30 * 60e3) {
      if (manual) toast(`Aktualisiert${x.trades ? ` · ${x.trades} neue Trades` : ''}${x.auto ? ` · ${x.auto} automatisch zugeordnet` : ''}`);
      if (isUnlocked()) milestones();
      return;
    }
  }
  const h = holdings();
  const r = await refreshPrices(Object.keys(h).filter((k) => h[k].qty > 1e-8));
  if (manual) toast(r.ok ? 'Kurse aktualisiert' : r.reason === 'offline' ? 'Offline – letzter Stand bleibt' : r.reason === 'busy' ? 'Kurse werden bereits geladen' : 'Kurse nicht erreichbar');
  if (isUnlocked()) milestones();
}
// Täglicher Vermögens-Snapshot (für die Analyse), sobald aktuelle Kurse da sind
function snapshot() { if (isUnlocked() && takeSnapshot()) commit(true); }
function milestones() {
  snapshot();
  const fresh = checkMilestones();
  if (fresh.length) { commit(); setTimeout(() => celebrate(fresh), 300); }
}

// ---------- Sperrbildschirm ----------
const MONO = `<svg class="monogram" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b98a5c"/><stop offset=".5" stop-color="#e7c9a1"/><stop offset="1" stop-color="#c79a6c"/></linearGradient></defs><rect x="1.5" y="1.5" width="61" height="61" rx="18" fill="none" stroke="url(#mg)" stroke-width="1.5"/><path d="M21 44V20h13M21 32h10" fill="none" stroke="url(#mg)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M36 20l7 24 7-24" fill="none" stroke="url(#mg)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const fmtWait = (ms) => (ms >= 60e3 ? `${Math.ceil(ms / 60e3)} Min.` : `${Math.ceil(ms / 1000)} s`);
async function showLock() {
  const first = !(await isSetUp());
  const el = $('#lock'); el.hidden = false;
  el.innerHTML = `<form class="lockbox" autocomplete="on" novalidate>
    ${MONO}<div class="brand">FINANCE VAULT</div><div class="lockt">${first ? 'Willkommen' : 'Entsperren'}</div>
    <div class="small mut">${first ? 'Lege einen PIN oder ein Passwort fest (mind. 6 Zeichen). Er verschlüsselt alle Daten auf diesem Gerät. Ohne ihn gibt es keinen Zugriff, auch nicht für dich. Sicher notieren!' : 'Deine Daten sind verschlüsselt.'}</div>
    <input type="text" name="username" value="Finance Vault" autocomplete="username" hidden>
    <input id="pin" type="password" autocomplete="${first ? 'new-password' : 'current-password'}" autocapitalize="off" spellcheck="false" placeholder="PIN / Passwort" aria-label="PIN oder Passwort">
    ${first ? '<input id="pin2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Wiederholen" aria-label="PIN wiederholen"><div class="small mut" id="str"></div>' : ''}
    <button type="submit" class="btn gold block big" id="go">${first ? 'Vault erstellen' : 'Entsperren'}</button>
    <div class="small" id="msg" role="status" aria-live="polite"></div>
    ${first ? '<div class="lbl mt">Neues Gerät?</div><button type="button" class="btn line block" id="srvrestore">☁ Vom Server wiederherstellen</button><label class="btn line block">⬆ Backup-Datei wiederherstellen<input type="file" id="restore" accept=".json,application/json" hidden></label>' : ''}</form>`;
  const form = el.querySelector('form'); const pin = $('#pin'); const msg = $('#msg'); const btn = $('#go');
  setTimeout(() => pin.focus(), 100);
  if (first) pin.addEventListener('input', () => {
    $('#str').textContent = !pin.value ? '' : /^\d+$/.test(pin.value) ? 'Nur Ziffern: bequem, aber schwach. Eine Passphrase (Wörter) ist viel sicherer.' : pin.value.length < 10 ? 'Gut – länger ist noch sicherer.' : 'Stark.';
  });
  if (first) $('#restore').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreOnWelcome(await f.text()); });
  if (first) $('#srvrestore').addEventListener('click', restoreFromServerScreen);
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (first) {
      if (pin.value.length < 6) { msg.textContent = 'Mindestens 6 Zeichen'; return; }
      if (pin.value !== $('#pin2').value) { msg.textContent = 'Eingaben stimmen nicht überein'; return; }
    }
    busy = true; btn.disabled = true;
    try {
      if (first) {
        msg.textContent = 'Verschlüssele …';
        const st = emptyState(); st.goals = defaultGoals(st);
        await setup(pin.value, st); setState(st);
      } else {
        msg.textContent = 'Prüfe …';
        let st;
        try { st = await unlock(pin.value); } catch (err) {
          if (err.wait) { msg.textContent = `Zu viele Fehlversuche. Bitte ${fmtWait(err.wait)} warten.`; return; }
          throw err;
        }
        if (!st) {
          const wait = await lockoutRemaining();
          msg.textContent = wait ? `Falscher PIN. Nächster Versuch in ${fmtWait(wait)}.` : 'Falscher PIN';
          pin.value = ''; pin.focus(); return;
        }
        setState(st);
      }
      pin.value = '';
      el.hidden = true; el.innerHTML = '';
      start();
    } catch (err) {
      console.error(err); msg.textContent = 'Fehler: ' + err.message;
    } finally { busy = false; btn.disabled = false; }
  });
}

// Neues Gerät: Server-Adresse + Kopplungscode -> neuestes Server-Backup laden
function restoreFromServerScreen() {
  const el = $('#lock');
  el.innerHTML = `<form class="lockbox" novalidate>${MONO}<div class="brand">FINANCE VAULT</div><div class="lockt">Vom Server holen</div>
    <div class="small mut">Tailscale auf diesem iPhone einschalten. Auf dem Laptop einen Kopplungscode erzeugen:<br><code>docker compose exec finance-vault python server.py pair</code></div>
    <input id="surl" type="url" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="https://laptop.tailnet.ts.net" aria-label="Server-Adresse">
    <input id="scode" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="Kopplungscode" aria-label="Kopplungscode">
    <button type="submit" class="btn gold block big" id="go">Neuestes Backup laden</button>
    <button type="button" class="btn line block" id="cancel">Abbrechen</button>
    <div class="small" id="msg" role="status" aria-live="polite"></div>
    <div class="small mut">Das alte Gerät wird nach der Wiederherstellung vom Server getrennt.</div></form>`;
  $('#cancel').addEventListener('click', () => { BK.dropPending(); showLock(); });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('#go'); btn.disabled = true; $('#msg').textContent = 'Verbinde und lade Backup …';
    try { restoreOnWelcome(await BK.restoreFromServer($('#surl').value, $('#scode').value), true); }
    catch (err) { $('#msg').textContent = err.message; btn.disabled = false; }
  });
}

// Backup direkt auf dem Willkommen-Bildschirm laden (z. B. nach Neuinstallation)
function restoreOnWelcome(text, fromServer = false) {
  const el = $('#lock'); let info;
  try { info = backupInfo(text); } catch (err) { $('#msg').textContent = err.message; return; }
  el.innerHTML = `<form class="lockbox" novalidate>
    ${MONO}<div class="brand">FINANCE VAULT</div><div class="lockt">${fromServer ? 'Backup vom Server' : 'Backup laden'}</div>
    <div class="small mut">${info.exported ? 'Backup vom ' + esc(new Date(info.exported).toLocaleDateString('de-CH')) + '. ' : ''}${info.needsPassword ? 'Backup-Passwort und PIN des Backups eingeben.' : 'Älteres Backup: nur PIN des Backups eingeben. Danach ein neues Backup mit Backup-Passwort erstellen.'}</div>
    ${info.needsPassword ? '<input id="bp" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Backup-Passwort" aria-label="Backup-Passwort">' : ''}
    <input id="bpin" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" placeholder="PIN des Backups" aria-label="PIN des Backups">
    <button type="submit" class="btn gold block big" id="go">Wiederherstellen</button>
    <button type="button" class="btn line block" id="cancel">Abbrechen</button>
    <div class="small" id="msg" role="status" aria-live="polite"></div></form>`;
  $('#cancel').addEventListener('click', () => { BK.dropPending(); showLock(); });
  setTimeout(() => ($('#bp') || $('#bpin')).focus(), 100);
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('#go'); btn.disabled = true; $('#msg').textContent = 'Entschlüssele und stelle wieder her …';
    try { await importBackup(text, { password: $('#bp')?.value || '', pin: $('#bpin').value }); location.reload(); }
    catch (err) { $('#msg').textContent = err.message || 'Backup ungültig'; btn.disabled = false; }
  });
}

function doLock() {
  lock(); clearState(); closeAll();
  $('#view').replaceChildren(); $('#title').textContent = ''; $('#sub').textContent = '';
  showLock();
}

let started = false;
async function start() {
  if (await BK.adoptPendingServer().catch(() => false)) toast('Server neu verbunden – altes Gerät getrennt', 4000);
  render();
  if (!started) { started = true; setInterval(() => { if (isUnlocked() && !document.hidden) updatePrices(); }, 5 * 60e3); }
  updatePrices();
}
// Erinnerungen nach Änderungen (z. B. neue Rechnung) automatisch an den Server
let srvTimer;
onChange(() => { clearTimeout(srvTimer); srvTimer = setTimeout(() => { if (isUnlocked() && SRV.isConfigured()) SRV.syncReminders().catch(() => {}); }, 4000); });

// ---------- Automatisch sperren + Sichtschutz im App-Umschalter ----------
let hiddenAt = null;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    document.body.classList.add('cover'); // verdeckt Beträge im App-Umschalter-Vorschaubild
    if (!isUnlocked()) return;
    hiddenAt = Date.now(); await flush().catch(() => {});
    return;
  }
  document.body.classList.remove('cover');
  checkForUpdate();
  if (!isUnlocked()) return;
  if (hiddenAt && Date.now() - hiddenAt > (S().settings.autoLockMin || 5) * 60e3) doLock();
  else updatePrices();
  hiddenAt = null;
});
addEventListener('pagehide', () => { if (isUnlocked()) flush().catch(() => {}); });
addEventListener('online', () => isUnlocked() && updatePrices());

// ---------- Events ----------
addEventListener('hashchange', () => { closeAll(); render(); $('#view').scrollTop = 0; });
addEventListener('rerender', render);
addEventListener('refreshprices', () => updatePrices(true));
addEventListener('serversync', () => { if (isUnlocked() && SRV.isConfigured()) SRV.syncAll({ force: true }); });
onChange(() => { render(); refreshSheet(); });
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); if (sheetOpen()) closeAll(); location.hash = g.dataset.go; }
});
$('#back').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
$('#sheet-back').addEventListener('click', closeSheet);
$('#sheet-bg').addEventListener('click', closeAll);
$('#refresh').addEventListener('click', () => updatePrices(true));
$('#sub').addEventListener('click', (e) => { const yb = e.target.closest('[data-y]'); if (yb) { taxUi.taxYear += +yb.dataset.y; render(); } });

// ---------- iPhone: Ansicht nach dem Schliessen der Tastatur zurücksetzen ----------
// iOS scrollt beim Fokussieren eines Feldes das ganze Dokument nach oben. Weil
// das Layout fest am Bildschirm hängt, bleibt danach ein verschobener Bereich
// bzw. ein Spalt unter der Tab-Leiste. Sobald kein Feld mehr fokussiert ist,
// wird das Dokument wieder auf 0 gesetzt (nicht während die Tastatur offen ist).
const isField = (el) => el && el.matches && el.matches('input, select, textarea, [contenteditable]');
function resetScroll() { if (!isField(document.activeElement) && (window.scrollY || window.scrollX)) window.scrollTo(0, 0); }
document.addEventListener('focusout', () => setTimeout(resetScroll, 80));
window.visualViewport?.addEventListener('resize', () => {
  if (window.visualViewport.height > window.innerHeight * 0.85) setTimeout(resetScroll, 50);
});

// ---------- App-Updates ----------
// iOS lädt eine Home-Bildschirm-App oft tagelang nicht neu. Beim Zurückkehren
// in die App wird deshalb aktiv nach einer neuen Version gesucht. Ist eine da,
// erscheint ein Hinweis (gesperrt: sofortiges Neuladen).
let swReg = null; let deployTag = null; let updateShown = false;
async function currentDeployTag() {
  try {
    const r = await fetch('./index.html', { method: 'HEAD', cache: 'no-store' });
    return r.ok ? (r.headers.get('etag') || r.headers.get('last-modified')) : null;
  } catch (e) { return null; }
}
function offerUpdate() {
  if (updateShown) return;
  if (!isUnlocked()) { location.reload(); return; }
  updateShown = true;
  const bar = document.createElement('button');
  bar.className = 'updatebar'; bar.type = 'button'; bar.textContent = 'Neue Version verfügbar – tippen zum Neuladen';
  bar.addEventListener('click', async () => { bar.disabled = true; await flush().catch(() => {}); location.reload(); });
  document.body.appendChild(bar);
}
async function checkForUpdate() {
  if (!navigator.onLine || location.protocol === 'file:') return;
  try { await swReg?.update(); } catch (e) { /* offline */ }
  const tag = await currentDeployTag();
  if (tag && deployTag && tag !== deployTag) offerUpdate();
  if (tag && !deployTag) deployTag = tag;
}

showLock();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { swReg = r; }).catch(() => {});
  // Neuer Service Worker hat übernommen -> Seite läuft noch mit altem Code
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) offerUpdate(); });
}
currentDeployTag().then((t) => { deployTag = t; });
