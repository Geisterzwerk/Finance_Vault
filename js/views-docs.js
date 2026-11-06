// =====================================================================
// views-docs.js – Scanner, Finance Inbox, Dokumente, Ledger-Abgleich,
// Jahresabschluss, Steuerzahlungen, Archiv und Prüfung
// =====================================================================
import { S, commit, uid } from './store.js';
import { holdings, yearEndHoldings } from './calc.js';
import { putFile, getFileURL, getFileBytes, deleteFile } from './vault.js';
import * as LG from './ledger.js';
import * as TP from './taxpack.js';
import * as BX from './bingx.js';
import { esc, chf, qty, dmy, ago, bar, icon, openSheet, closeSheet, closeAll, toast, download, chips, chipVal } from './ui.js';
import { openScanner } from './scanui.js';

export { openScanner };
const CATS = ['Einkommen', 'Vorsorge', 'Vermögen', 'Steuern', 'Studium', 'Gesundheit', 'Spenden', 'Mobilität', 'Versicherung', 'Kommunikation', 'Wohnen', 'Abos', 'Sonstiges'];
const yearNow = () => new Date().getFullYear();

// ---------- Ergebnis prüfen und ablegen ----------
export function openResult(d, inboxDoc = null) {
  const capture = (el) => {
    const v = (n) => el.querySelector(`[name=${n}]`)?.value ?? '';
    Object.assign(d, { issuer: v('issuer'), title: v('title'), number: v('number'), amount: v('amount'), due: v('due'), date: v('date'), category: v('category'),
      ziffer: v('ziffer'), taxKind: v('taxKind'), taxYear: v('taxYear'), year: v('year'), tax: chipVal(el, 'tax') || d.tax, kind: chipVal(el, 'kind') || d.kind });
  };
  openSheet({
    title: 'Dokument erkannt', capture,
    render: () => `
      ${d.qr ? '<div class="note">✓ QR-Rechnung erkannt: Empfänger und Betrag stammen direkt aus dem QR-Code.</div>' : ''}
      <button class="btn line block" data-act="view">Dokument ansehen</button>
      <div class="lbl mt">Was ist das?</div>${chips('kind', [['invoice', 'Rechnung (zu bezahlen)'], ['doc', 'Dokument / Beleg']], d.kind)}
      <label class="field"><span>Absender / Aussteller</span><input name="issuer" value="${esc(d.issuer)}"></label>
      <div class="grid2">
        <label class="field"><span>Bezeichnung</span><input name="title" value="${esc(d.title)}"></label>
        <label class="field"><span>Nummer / Referenz</span><input name="number" value="${esc(d.number)}"></label>
        <label class="field"><span>Betrag CHF</span><input name="amount" inputmode="decimal" value="${esc(d.amount)}"></label>
        <label class="field"><span>Fällig am</span><input name="due" type="date" value="${esc(d.due)}"></label>
        <label class="field"><span>Dokumentdatum</span><input name="date" type="date" value="${esc(d.date)}"></label>
        <label class="field"><span>Steuerjahr</span><input name="year" inputmode="numeric" value="${esc(d.year)}"></label>
      </div>
      <label class="field"><span>Kategorie</span><select name="category">${CATS.map((c) => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <div class="lbl">Steuer</div>${chips('tax', [['no', 'nicht relevant'], ['maybe', 'möglicherweise'], ['yes', 'steuerrelevant']], d.tax)}
      <label class="field"><span>E-Tax-Ziffer</span><input name="ziffer" value="${esc(d.ziffer)}" inputmode="numeric"></label>
      <div class="grid2"><label class="field"><span>Steuerart (bei Steuerrechnung)</span><select name="taxKind"><option value="">–</option>${TP.TAX_KINDS.map((k) => `<option ${k === d.taxKind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="field"><span>Für Steuerjahr</span><input name="taxYear" inputmode="numeric" value="${esc(d.taxYear)}"></label></div>
      ${d.text ? `<details class="card small"><summary>Erkannter Text</summary><pre class="ocr">${esc(d.text.slice(0, 2500))}</pre></details>` : ''}
      <button class="btn gold block big mt" data-act="save">Speichern</button>
      ${!inboxDoc ? '<button class="btn line block" data-act="later">Später (in die Finance Inbox)</button>' : ''}
      <button class="btn danger block" data-act="drop">Verwerfen</button>`,
    bind: (el) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const s = S();
      capture(el);
      if (b.dataset.act === 'view') { const u = await getFileURL(d.file); if (u) window.open(u, '_blank', 'noopener'); return; }
      const removeInbox = () => { if (inboxDoc) s.documents = s.documents.filter((x) => x.id !== inboxDoc.id); };
      if (b.dataset.act === 'drop') { if (!confirm('Dokument verwerfen?')) return; await deleteFile(d.file); removeInbox(); commit(); closeSheet(); return; }
      if (b.dataset.act === 'later') { s.documents.push({ id: uid(), status: 'inbox', created: new Date().toISOString(), ...d }); commit(); toast('In der Finance Inbox'); closeSheet(); return; }
      const amount = d.amount === '' ? null : Number(String(d.amount).replace(/['’]/g, '').replace(',', '.'));
      removeInbox();
      if (d.kind === 'invoice') {
        if (!d.issuer.trim() || amount == null) return toast('Aussteller und Betrag angeben');
        s.invoices.push({ id: uid(), created: new Date().toISOString(), issuer: d.issuer.trim(), title: d.title, number: d.number, amount, due: d.due, status: 'open', paidAt: '',
          category: d.category, tax: d.tax, ziffer: d.ziffer, taxKind: d.category === 'Steuern' ? d.taxKind || 'Staat BL' : '', taxYear: d.category === 'Steuern' ? +d.taxYear || null : null,
          file: d.file, fileName: d.fileName, iban: d.iban, reference: d.reference, note: '' });
        toast('Als offene Rechnung gespeichert');
      } else {
        s.documents.push({ id: uid(), status: 'done', kind: 'doc', created: new Date().toISOString(), title: d.title || d.issuer, issuer: d.issuer, number: d.number, amount, date: d.date,
          year: +d.year || yearNow(), category: d.category, tax: d.tax, ziffer: d.ziffer, file: d.file, fileName: d.fileName, text: d.text });
        toast('Dokument abgelegt');
      }
      commit(); closeSheet();
    }),
  });
}

// =====================================================================
// FINANCE INBOX + DOKUMENTE
// =====================================================================
export const ui = { docSearch: '' };
export function inboxPage() {
  const s = S(); const docs = s.documents.filter((d) => d.status === 'inbox'); const rc = s.transactions.filter((t) => t.type === 'review').length;
  return {
    title: 'Finance Inbox', sub: 'Alles Neue landet zuerst hier',
    html: `<button class="btn gold block" data-act="scan">📷 Dokument scannen / hochladen</button>
      ${rc ? `<div class="card row clickable" data-go="#/vault/pruefen">${icon('warn')}<div class="grow"><b>${rc} Transaktion${rc > 1 ? 'en' : ''} zuordnen</b></div><span class="gold">›</span></div>` : ''}
      <div class="lbl mt">Dokumente zum Prüfen (${docs.length})</div>
      ${docs.map((d) => `<div class="card row clickable" data-doc="${d.id}">${icon('warn')}<div class="grow"><b>${esc(d.issuer || 'Unbekannt')}</b><div class="small mut">${esc(d.category)} · ${d.amount ? chf(+d.amount, 2) : ''} · ${dmy(d.created)}</div></div><span class="gold">›</span></div>`).join('') || '<div class="card small mut">Inbox leer 👍</div>'}`,
    bind: (el) => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act=scan]')) return openScanner();
      const c = e.target.closest('[data-doc]'); if (c) { const d = S().documents.find((x) => x.id === c.dataset.doc); openResult({ ...d }, d); }
    }),
  };
}

export function documentsPage() {
  const s = S(); const q = ui.docSearch.toLowerCase();
  const docs = s.documents.filter((d) => d.status !== 'inbox' && (!q || `${d.title} ${d.issuer} ${d.category} ${d.text || ''} ${d.year}`.toLowerCase().includes(q)));
  const years = [...new Set(docs.map((d) => d.year))].sort((a, b) => b - a);
  const KL = { erklaerung: 'Steuererklärung', veranlagung: 'Veranlagung' };
  return {
    title: 'Dokumente', sub: `${docs.length} Dokumente · verschlüsselt`,
    html: `<input class="search" data-search placeholder="Suchen (auch im erkannten Text) …" value="${esc(ui.docSearch)}">
      <button class="btn gold block" data-act="scan">📷 Dokument scannen / hochladen</button>
      ${years.map((y) => `<div class="lbl mt">${y}</div>${docs.filter((d) => d.year === y).map((d) => `<div class="card row clickable" data-doc="${d.id}">
        ${d.tax === 'yes' ? icon('ok') : d.tax === 'maybe' ? icon('warn') : '<span class="ic empty"></span>'}<div class="grow"><b>${esc(KL[d.kind] || d.title || d.issuer || 'Dokument')}</b>
        <div class="small mut">${esc(d.category || '')}${d.ziffer ? ' · Ziffer ' + esc(d.ziffer) : ''}${d.amount ? ' · ' + chf(+d.amount, 2) : ''}</div></div><span class="gold">›</span></div>`).join('')}`).join('') || '<div class="card small mut mt">Noch keine Dokumente</div>'}
      <div class="small mut mt">Rechnungen findest du unter Rechnungen. Belege dort zählen ebenfalls für die Steuer.</div>`,
    bind: (el) => {
      const sI = el.querySelector('[data-search]');
      sI.addEventListener('input', () => { ui.docSearch = sI.value; dispatchEvent(new Event('rerender')); const n = document.querySelector('[data-search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-act=scan]')) return openScanner();
        const c = e.target.closest('[data-doc]'); if (c) openDoc(S().documents.find((x) => x.id === c.dataset.doc));
      });
    },
  };
}

function openDoc(d) {
  openSheet({
    title: d.title || 'Dokument',
    render: () => `
      <button class="btn gold block" data-act="view">Dokument öffnen</button>
      <label class="field mt"><span>Titel</span><input name="title" value="${esc(d.title || '')}"></label>
      <div class="grid2"><label class="field"><span>Steuerjahr</span><input name="year" inputmode="numeric" value="${esc(d.year)}"></label>
        <label class="field"><span>Ziffer</span><input name="ziffer" value="${esc(d.ziffer || '')}"></label>
        <label class="field"><span>Betrag CHF</span><input name="amount" inputmode="decimal" value="${esc(d.amount ?? '')}"></label>
        <label class="field"><span>Kategorie</span><select name="category">${CATS.map((c) => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <div class="lbl">Steuer</div>${chips('tax', [['no', 'nicht relevant'], ['maybe', 'möglicherweise'], ['yes', 'steuerrelevant']], d.tax || 'no')}
      <button class="btn line block" data-act="save">Speichern</button>
      <button class="btn danger block" data-act="del">Löschen</button>`,
    bind: (el) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const s = S();
      if (b.dataset.act === 'view') { const u = await getFileURL(d.file); if (u) window.open(u, '_blank', 'noopener'); }
      if (b.dataset.act === 'save') {
        const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
        Object.assign(d, { title: v('title'), year: +v('year') || d.year, ziffer: v('ziffer'), amount: v('amount') === '' ? null : Number(v('amount').replace(',', '.')), category: v('category'), tax: chipVal(el, 'tax') || d.tax });
        commit(); toast('Gespeichert'); closeSheet();
      }
      if (b.dataset.act === 'del' && confirm('Dokument löschen?')) { if (d.file) await deleteFile(d.file); s.documents = s.documents.filter((x) => x.id !== d.id); commit(); closeSheet(); }
    }),
  });
}

// =====================================================================
// LEDGER-ABGLEICH
// =====================================================================
export function ledgerPage() {
  const s = S(); const L = s.ledger; const last = L.last;
  const app = holdings();
  let bx = {}; try { if (s.raw.bingx && s.raw.bingx.length) bx = BX.analyse(s.raw.bingx).balances; } catch (e) { bx = {}; }
  const syms = [...new Set([...Object.keys(last ? last.total : {}), ...Object.keys(app).filter((k) => app[k].qty > 1e-8)])].sort();
  const rows = last ? syms.map((k) => {
    const lq = last.total[k] || 0, bq = Math.max(0, bx[k] || 0), aq = app[k] ? app[k].qty : 0;
    const diff = aq - lq - bq; const rel = Math.abs(diff) / Math.max(aq, lq + bq, 1e-12);
    return { k, lq, bq, aq, diff, st: rel < 0.005 || Math.abs(diff) < 1e-6 ? 'ok' : 'warn', tracked: k in last.total };
  }) : [];
  return {
    title: 'Ledger', sub: 'Abgleich über öffentliche Adressen · nur lesen',
    html: `<div class="note">Nur <b>öffentliche Adressen</b> eintragen. Niemals die 24 Wörter, PIN oder Private Keys.</div>
      ${L.addresses.map((a) => `<div class="card row"><div class="grow"><b>${esc(LG.CHAINS[a.chain].label)}</b><div class="small mut">${esc(a.label || '')} ${esc(a.address.slice(0, 10))}…${esc(a.address.slice(-6))}</div></div><button class="btn danger sm" data-del="${a.id}">✕</button></div>`).join('')}
      <button class="btn line block" data-act="add">＋ Adresse hinzufügen</button>
      ${L.addresses.length ? `<button class="btn gold block big" data-act="sync">↻ Bestände abfragen</button>` : ''}
      ${last ? `<div class="lbl mt">Abgleich · ${dmy(last.at)} ${ago(last.at)}</div>
        <div class="card"><div class="ttable lt"><div class="th"><span>Coin</span><span>Ledger</span><span>BingX</span><span>App</span></div>
        ${rows.map((r) => `<div class="tr"><b>${esc(r.k)}</b><span>${r.tracked ? qty(r.lq) : '–'}</span><span>${r.bq ? qty(r.bq) : '–'}</span><b>${qty(r.aq)}</b>
          <small class="${!r.tracked ? 'mut' : r.st === 'ok' ? 'pos' : 'amber'}">${!r.tracked ? 'keine Adresse hinterlegt' : r.st === 'ok' ? 'stimmt überein' : `Differenz ${r.diff > 0 ? '+' : ''}${qty(r.diff)} (App ${r.diff > 0 ? 'zu hoch' : 'zu tief'})`}</small>
          ${r.tracked && r.st !== 'ok' ? `<button class="btn line sm fixbtn" data-fix="${esc(r.k)}" data-diff="${r.diff}">Ausgleich buchen</button>` : ''}</div>`).join('')}</div></div>
        ${last.errors && last.errors.length ? `<div class="card small amber">${last.errors.map((e) => `${esc(LG.CHAINS[e.chain].label)}: ${esc(e.error)}`).join('<br>')}</div>` : ''}
        <div class="small mut">«App» = Bestand aus deinen Transaktionen. Erwartet: App = Ledger + Rest auf BingX. Eine Differenz heisst meist: Kauf, Verkauf oder Gebühr fehlt.</div>` : ''}`,
    bind: (el) => el.addEventListener('click', async (e) => {
      const s2 = S();
      const del = e.target.closest('[data-del]'); if (del) { s2.ledger.addresses = s2.ledger.addresses.filter((a) => a.id !== del.dataset.del); commit(); return; }
      const fix = e.target.closest('[data-fix]');
      if (fix) {
        const diff = +fix.dataset.diff; const sym = fix.dataset.fix;
        if (!confirm(diff < 0 ? `${qty(-diff)} ${sym} als Anfangsbestand ohne Kaufpreis buchen?` : `${qty(diff)} ${sym} zum Zuordnen in die Inbox legen (Verkauf, Gebühr oder Transfer)?`)) return;
        s2.transactions.push(diff < 0
          ? { id: uid(), type: 'opening', asset: sym, amount: -diff, chf: null, fee: 0, date: new Date().toISOString(), platform: 'Ledger', note: 'Ausgleich Ledger-Abgleich', extId: '' }
          : { id: uid(), type: 'review', asset: sym, amount: diff, chf: null, fee: 0, date: new Date().toISOString(), platform: 'Ledger', raw: `App zeigt ${qty(diff)} ${sym} mehr als Ledger + BingX`, note: 'Verkauf, Gebühr oder Transfer?', extId: '' });
        commit(); toast('Gebucht'); return;
      }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'add') openAddress();
      if (b.dataset.act === 'sync') {
        if (!navigator.onLine) return toast('Offline');
        b.disabled = true;
        const r = await LG.syncAll(s2.ledger.addresses, (i, n) => { b.textContent = `Abfrage ${i}/${n} …`; });
        s2.ledger.last = r; commit(); toast(r.errors.length ? `${r.errors.length} Abfrage(n) fehlgeschlagen` : 'Bestände aktualisiert');
      }
    }),
  };
}
function openAddress() {
  openSheet({
    title: 'Adresse hinzufügen',
    render: () => `<label class="field"><span>Kette</span><select name="chain">${Object.entries(LG.CHAINS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}</select></label>
      <div class="small mut" data-hint>${esc(LG.CHAINS.btc.hint)}</div>
      <label class="field mt"><span>Öffentliche Adresse</span><input name="addr" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>Bezeichnung (optional)</span><input name="label" placeholder="z. B. Ledger BTC Konto 1"></label>
      <div class="small mut">In Ledger Live: Konto öffnen › Empfangen › Adresse kopieren. Bei Bitcoin entstehen mit jedem Empfang neue Adressen – alle verwendeten mit Komma eintragen.</div>
      <button class="btn gold block big mt" data-act="save">Speichern</button>`,
    bind: (el) => {
      const sel = el.querySelector('[name=chain]');
      sel.addEventListener('change', () => { el.querySelector('[data-hint]').textContent = LG.CHAINS[sel.value].hint; });
      el.querySelector('[data-act=save]').addEventListener('click', () => {
        const a = el.querySelector('[name=addr]').value.trim();
        if (a.length < 20 || /\s\S+\s\S+\s\S+\s/.test(a) && !a.includes(',')) return toast('Das sieht nicht wie eine Adresse aus');
        S().ledger.addresses.push({ id: uid(), chain: sel.value, address: a, label: el.querySelector('[name=label]').value.trim() });
        commit(); closeSheet();
      });
    },
  });
}

// =====================================================================
// STEUERN: Jahresabschluss, Zahlungen, Archiv, Prüfung
// =====================================================================
export function openClosing(y) {
  openSheet({
    title: `Jahresabschluss ${y}`, live: true,
    render: () => {
      const c = TP.yearEndCheck(y); const t = S().taxYears[y] || {};
      return `${c.ready ? `<div class="card goldb"><b class="pos">✓ Alles bereit</b><div class="small">Bestand per 31.12.${y}, 23:59 Uhr kann eingefroren werden.</div></div>`
        : `<div class="card goldb"><b class="amber">Noch nicht bereit</b><div class="small">Bitte zuerst die markierten Punkte aktualisieren, dann Steuerunterlagen erstellen.</div></div>`}
        <div class="lbl mt">Datenstand per 31.12.${y}</div>
        ${c.items.map((i) => `<div class="chk ${i.ok ? '' : 'clickable'}" ${i.ok ? '' : `data-fix="${i.fix}"`}>${i.ok ? icon('ok') : icon('warn')}<b class="grow">${esc(i.label)}</b><span class="small ${i.ok ? 'pos' : 'amber'}">${esc(i.detail)}</span></div>`).join('')}
        ${t.closed ? `<div class="note">Abgeschlossen am ${dmy(t.closed)}.</div>` : `<button class="btn gold block big mt" data-act="close" ${c.ready ? '' : 'disabled'}>Jahr abschliessen</button>`}
        <button class="btn line block" data-act="pack">📦 Steuerpaket erstellen${t.closed ? '' : ' (Entwurf)'}</button>
        <button class="btn line block" data-act="ics">📅 Erinnerungen in Kalender übernehmen</button>`;
    },
    bind: (el) => el.addEventListener('click', async (e) => {
      const f = e.target.closest('[data-fix]'); if (f) { closeAll(); location.hash = f.dataset.fix; return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'close') closeYear(y);
      if (b.dataset.act === 'pack') makePackage(y, b);
      if (b.dataset.act === 'ics') download('FinanceVault_Erinnerungen.ics', TP.remindersICS(), 'text/calendar');
    }),
  });
}
export function closeYear(y) {
  const s = S(); const t = (s.taxYears[y] ||= { rates: {}, checklist: {} });
  const hold = Object.values(yearEndHoldings(y)).filter((x) => x.qty > 1e-8).map((x) => ({ asset: x.asset, qty: x.qty, quality: x.quality }));
  if (hold.some((h) => !t.rates[h.asset])) return toast('Steuerkurse fehlen');
  if (!confirm(`Bestand und Kurse per 31.12.${y} einfrieren?`)) return;
  t.snapshot = { holdings: hold, rates: JSON.parse(JSON.stringify(t.rates)) }; t.closed = new Date().toISOString(); t.checklist.crypto = true;
  commit(); toast(`Steuerjahr ${y} abgeschlossen`);
}
export async function makePackage(y, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Erstelle Paket …'; }
  try { const { blob, count } = await TP.buildPackage(y); download(`Steuerpaket_${y}.zip`, blob); toast(`${count} Dateien im Steuerpaket`); }
  catch (e) { console.error(e); toast('Paket konnte nicht erstellt werden'); }
  if (btn) { btn.disabled = false; btn.textContent = '📦 Steuerpaket erstellen'; }
}

export function taxExtrasHTML(y) {
  const s = S(); const pay = TP.taxPayments(y); const t = s.taxYears[y] || {};
  const er = s.documents.find((d) => d.kind === 'erklaerung' && +d.year === y);
  const ve = s.documents.find((d) => d.kind === 'veranlagung' && +d.year === y);
  return `
  <div class="card row clickable ${t.closed ? '' : 'goldb'}" data-x="closing">${t.closed ? icon('ok') : icon('warn')}<div class="grow"><b>Jahresabschluss ${y}</b><div class="small mut">${t.closed ? 'abgeschlossen ' + dmy(t.closed) : 'Datencheck, Snapshot 31.12., Steuerpaket'}</div></div><span class="gold">›</span></div>
  <button class="btn gold block" data-x="pack">📦 Steuerpaket ${y} erstellen</button>
  <div class="lbl mt">Steuerzahlungen ${y}</div>
  <div class="card">${pay.list.length ? `<div class="row"><div class="serif big2 grow">${chf(pay.soll)}</div><b class="${pay.open > 0 ? 'amber' : 'pos'}">${pay.soll ? Math.round((pay.paid / pay.soll) * 100) : 0} % bezahlt</b></div>
    ${bar(pay.soll ? pay.paid / pay.soll : 0, 'green')}
    ${Object.entries(pay.by).map(([k, v]) => `<div class="txr"><span class="grow">${v.paid >= v.soll ? icon('ok') : icon('warn')} ${esc(k)}</span><span class="small">${chf(v.paid)} / ${chf(v.soll)}</span></div>`).join('')}
    <div class="small mut mt">Offen ${chf(pay.open, 2)}</div>` : `<div class="small mut">Noch keine Steuerrechnungen für ${y}. Erfasse sie unter Rechnungen mit Kategorie «Steuern» oder scanne den Brief.</div>`}</div>
  <div class="lbl mt">Archiv ${y}</div>
  <div class="card">
    <div class="txr">${er ? icon('ok') : '<span class="ic empty"></span>'}<span class="grow">Eingereichte Steuererklärung</span>${er ? `<button class="btn line sm" data-open="${er.id}">Öffnen</button>` : `<label class="btn line sm">PDF<input type="file" accept="application/pdf" data-up="erklaerung" hidden></label>`}</div>
    <div class="txr">${ve ? icon('ok') : '<span class="ic empty"></span>'}<span class="grow">Veranlagungsverfügung</span>${ve ? `<button class="btn line sm" data-open="${ve.id}">Öffnen</button>` : `<label class="btn line sm">PDF/Foto<input type="file" accept="application/pdf,image/*" data-up="veranlagung" hidden></label>`}</div>
    ${er ? '<button class="btn gold block mt" data-x="audit">✓ Steuererklärung mit Vault abgleichen</button>' : '<div class="small mut mt">Lade deine fertige Erklärung aus E-Tax BL hoch, dann prüft Finance Vault, ob etwas fehlt.</div>'}
  </div>
  ${archiveList()}`;
}
function archiveList() {
  const s = S(); const yrs = Object.keys(s.taxYears).map(Number).filter((y) => s.taxYears[y].closed).sort((a, b) => b - a);
  return yrs.length ? `<div class="lbl mt">Abgeschlossene Jahre</div>${yrs.map((y) => `<div class="card row clickable" data-year="${y}">${icon('ok')}<b class="grow">${y}</b><span class="small mut">${s.documents.filter((d) => +d.year === y && d.status !== 'inbox').length} Dokumente</span><span class="gold">›</span></div>`).join('')}` : '';
}
export function bindTaxExtras(el, y, setYear) {
  el.querySelectorAll('[data-up]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0]; inp.value = ''; if (!f) return;
    const fid = uid(); await putFile(fid, f);
    S().documents.push({ id: uid(), status: 'done', kind: inp.dataset.up, title: inp.dataset.up === 'erklaerung' ? `Steuererklärung ${y}` : `Veranlagung ${y}`, year: y, category: 'Steuern', tax: 'yes', file: fid, fileName: f.name, created: new Date().toISOString() });
    commit(); toast('Im Archiv gespeichert');
  }));
  el.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]'); if (o) { const d = S().documents.find((x) => x.id === o.dataset.open); const u = await getFileURL(d.file); if (u) window.open(u, '_blank', 'noopener'); return; }
    const yr = e.target.closest('[data-year]'); if (yr) { setYear(+yr.dataset.year); return; }
    const x = e.target.closest('[data-x]'); if (!x) return;
    if (x.dataset.x === 'closing') openClosing(y);
    if (x.dataset.x === 'pack') makePackage(y, x);
    if (x.dataset.x === 'audit') runAudit(y, x);
  });
}
async function runAudit(y, btn) {
  const d = S().documents.find((x) => x.kind === 'erklaerung' && +x.year === y);
  btn.disabled = true; btn.textContent = 'Lese Steuererklärung …';
  try {
    const f = await getFileBytes(d.file);
    const text = await TP.pdfText(f.bytes);
    if (text.replace(/\s/g, '').length < 50) throw new Error('Kein Text im PDF (eingescannt?)');
    const r = TP.audit(y, text);
    openSheet({
      title: 'Prüfung ' + y,
      render: () => `<div class="card hero"><div class="lbl">Abgleich mit Finance Vault</div><div class="row"><div class="serif huge grow">${r.score} %</div><span class="small amber">${r.res.filter((x) => x.st !== 'ok').length} Punkte prüfen</span></div>${bar(r.score / 100)}</div>
        ${r.res.map((x) => `<div class="card row">${icon(x.st === 'ok' ? 'ok' : x.st === 'warn' ? 'warn' : 'bad')}<div class="grow"><b>${esc(x.label)}</b><div class="small ${x.st === 'ok' ? 'mut' : x.st === 'warn' ? 'amber' : 'neg'}">${esc(x.detail)}</div></div></div>`).join('')}
        <div class="small mut">Ampel statt Garantie: Die Prüfung sucht Beträge und Namen im Text der Erklärung. Abweichungen bitte selbst kontrollieren.</div>`,
    });
  } catch (e) { toast(e.message.includes('Text') ? e.message : 'PDF konnte nicht gelesen werden (offline?)'); }
  btn.disabled = false; btn.textContent = '✓ Steuererklärung mit Vault abgleichen';
}
