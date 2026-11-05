// =====================================================================
// views-more.js – Steuern, Rechnungen, Vault (Import, Prüfen, Einstellungen)
// =====================================================================
import { S, commit, flush, uid, setState, demoState, emptyState, defaultGoals } from './store.js';
import { TYPES, yearEndHoldings } from './calc.js';
import { historicalCHF } from './prices.js';
import { parseCSV, guessMapping, interpret, preview, toTransactions, ROLES } from './importer.js';
import { putFile, getFileURL, deleteFile, exportBackup, importBackup, wipeAll, changePin, lock } from './vault.js';
import {
  esc, chf, qty, price, dmy, dmyShort, ago, daysUntil, isoDay, bar, icon, openSheet, closeSheet, closeAll,
  toast, download, chips, bindChips, chipVal, rerender,
} from './ui.js';
import { TAX_TOTAL } from './views-main.js';

export const ui = { taxYear: new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear(), invSearch: '' };

// Checkliste Basel-Landschaft (Ziffern aus der Steuererklärung 2023, jährlich prüfen)
export const CHECKLIST = [
  ['lohn', 'Lohnausweis', '100', 'Einkommen'],
  ['weg', 'Arbeitsweg ÖV', '500', 'Berufsauslagen'],
  ['verpfl', 'Auswärtige Verpflegung', '510', 'Berufsauslagen'],
  ['beruf', 'Übrige Berufskosten', '520', 'Berufsauslagen'],
  ['3a', 'VIAC Säule 3a Bescheinigung', '610', 'Vorsorge'],
  ['bildung', 'Aus- und Weiterbildung (TEKO)', '650', 'Abzüge'],
  ['krank', 'Krankheits- und Unfallkosten', '720', 'Abzüge'],
  ['spenden', 'Spenden / Zuwendungen', '738', 'Abzüge'],
  ['bank', 'Bank-Steuerauszüge, VIAC Invest', '800', 'Vermögen'],
  ['crypto', 'Crypto-Steuerbericht', '800', 'Vermögen'],
];
const ty = (y) => (S().taxYears[y] ||= { rates: {}, checklist: {}, closed: null, snapshot: null });

// =====================================================================
// STEUERN
// =====================================================================
export function taxes() {
  const y = ui.taxYear; const t = ty(y);
  const snap = t.closed ? t.snapshot : null;
  const hold = snap ? snap.holdings : Object.values(yearEndHoldings(y)).filter((x) => x.qty > 1e-10).map((x) => ({ asset: x.asset, qty: x.qty, quality: x.quality }));
  const rates = snap ? snap.rates : t.rates;
  let total = 0, missingRate = 0;
  for (const h of hold) { const r = rates[h.asset]; if (r && r.chf != null) total += h.qty * r.chf; else missingRate++; }
  const done = CHECKLIST.filter(([k]) => t.checklist[k]).length;
  const inv = S().invoices.filter((i) => i.tax !== 'no' && new Date(i.paidAt || i.due).getFullYear() === y);
  const byZ = {}; inv.forEach((i) => { const z = i.ziffer || '–'; (byZ[z] ||= []).push(i); });
  const groups = [...new Set(CHECKLIST.map((c) => c[3]))];
  return {
    title: `Steuern ${y}`, sub: `${esc(S().settings.canton)} · E-Tax BL
      <button class="ybtn" data-y="-1">‹</button><button class="ybtn" data-y="1">›</button>`,
    html: `
    <div class="card hero"><div class="lbl">Vorbereitung</div><div class="row"><div class="serif huge grow">${Math.round((done / TAX_TOTAL) * 100)} %</div><span class="small mut">${done} von ${TAX_TOTAL} erledigt</span></div>${bar(done / TAX_TOTAL)}</div>

    <div class="lbl mt">Crypto-Steuerbericht · Bestand per 31.12.${y}</div>
    <div class="card ${snap ? 'goldb' : ''}">
      <div class="row"><div class="grow"><div class="small mut">Steuerwert Crypto total</div><div class="serif big2">${chf(total)}</div></div>
        ${snap ? `<span class="tag gold">abgeschlossen ${dmyShort(t.closed)}</span>` : ''}</div>
      <div class="small gold2">Eintragen: Wertschriften- und Guthabenverzeichnis (Ziffer 800)</div>
      <div class="ttable"><div class="th"><span>Asset</span><span>Bestand</span><span>Kurs</span><span>Wert</span></div>
      ${hold.map((h) => { const r = rates[h.asset]; return `<div class="tr ${snap ? '' : 'clickable'}" data-rate="${esc(h.asset)}"><b>${esc(h.asset)}</b><span>${qty(h.qty)}</span><span>${r && r.chf != null ? nrp(r.chf) : '<i class="amber">fehlt</i>'}</span><b>${r && r.chf != null ? chf(h.qty * r.chf) : '–'}</b>
        <small class="${!r ? 'amber' : r.source === 'ESTV' ? 'pos' : 'amber'}">${r ? 'Kurs: ' + esc(r.source) : 'Steuerkurs eintragen'}${h.quality && h.quality !== 'ok' ? ' · Kaufhistorie prüfen' : ''}</small></div>`; }).join('') || '<div class="small mut">Kein Crypto-Bestand per 31.12.</div>'}</div>
      ${!snap ? `<div class="small mut mt">Steuerkurse findest du in der ESTV-Kursliste (ICTax). Fehlt dort ein Coin, gilt der Jahresendkurs der Plattform als Ersatz.</div>
        <div class="grid2 mt"><a class="btn line" href="https://www.ictax.admin.ch" target="_blank" rel="noopener">ESTV ICTax öffnen</a><button class="btn line" data-act="fallback">Ersatzkurse laden</button></div>
        <button class="btn gold block mt" data-act="close" ${missingRate ? 'disabled' : ''}>${missingRate ? `${missingRate} Steuerkurs${missingRate > 1 ? 'e' : ''} fehlen` : `Jahr ${y} abschliessen (Snapshot einfrieren)`}</button>`
        : `<button class="btn line block mt" data-act="reopen">Abschluss aufheben</button>`}
      <div class="grid2 mt"><button class="btn line" data-act="print">PDF / Drucken</button><button class="btn line" data-act="csv">CSV exportieren</button></div>
    </div>

    <div class="lbl mt">Checkliste E-Tax BL</div>
    ${groups.map((g) => `<div class="small mut gl">${g}</div>${CHECKLIST.filter((c) => c[3] === g).map(([k, l, z]) => `
      <div class="chk clickable" data-chk="${k}">${t.checklist[k] ? icon('ok') : '<span class="ic empty"></span>'}<span class="grow ${t.checklist[k] ? '' : 'b'}">${l}</span><span class="small mut">Ziffer ${z}</span></div>`).join('')}`).join('')}
    <div class="small mut mt">Die Ziffern stammen aus deiner Steuererklärung 2023. Bitte jedes Jahr im E-Tax BL kontrollieren.</div>

    ${inv.length ? `<div class="lbl mt">Steuerrelevante Belege ${y}</div>${Object.entries(byZ).map(([z, list]) => `<div class="card"><div class="row"><b class="grow">Ziffer ${esc(z)}</b><b>${chf(list.reduce((a, i) => a + (+i.amount || 0), 0), 2)}</b></div>
      ${list.map((i) => `<div class="txr clickable" data-inv="${i.id}">${i.tax === 'yes' ? icon('ok') : icon('warn')}<span class="grow small">${esc(i.issuer)} · ${esc(i.title || '')}</span><span class="small">${chf(+i.amount, 2)}</span></div>`).join('')}</div>`).join('')}` : ''}`,
    bind: (el) => el.addEventListener('click', async (e) => {
      const yb = e.target.closest('[data-y]'); if (yb) { ui.taxYear += +yb.dataset.y; dispatchEvent(new Event('rerender')); return; }
      const c = e.target.closest('[data-chk]'); if (c) { t.checklist[c.dataset.chk] = !t.checklist[c.dataset.chk]; commit(); return; }
      const i = e.target.closest('[data-inv]'); if (i) return openInvoice(S().invoices.find((q) => q.id === i.dataset.inv));
      const r = e.target.closest('[data-rate]'); if (r && !snap) return openRate(y, r.dataset.rate);
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'fallback') {
        if (!navigator.onLine) return toast('Offline');
        b.disabled = true; b.textContent = 'Lade …'; let n = 0;
        for (const h of hold) if (!t.rates[h.asset]) {
          const v = await historicalCHF(h.asset, new Date(y, 11, 31, 12));
          if (v != null) { t.rates[h.asset] = { chf: v, source: 'CoinGecko 31.12. (Ersatz, prüfen)' }; n++; }
        }
        commit(); toast(`${n} Ersatzkurse geladen`);
      }
      if (b.dataset.act === 'close' && confirm(`Bestand und Kurse per 31.12.${y} einfrieren? Spätere Transaktionen verändern diesen Snapshot nicht mehr.`)) {
        t.snapshot = { holdings: hold.map((h) => ({ ...h })), rates: JSON.parse(JSON.stringify(t.rates)) }; t.closed = new Date().toISOString(); t.checklist.crypto = true; commit(); toast(`Steuerjahr ${y} abgeschlossen`);
      }
      if (b.dataset.act === 'reopen' && confirm('Abschluss aufheben? Bestand wird wieder live aus den Transaktionen berechnet.')) { t.closed = null; t.snapshot = null; commit(); }
      if (b.dataset.act === 'csv') {
        const lines = [['Asset', 'Bestand 31.12.' + y, 'Steuerkurs CHF', 'Steuerwert CHF', 'Kursquelle'].join(';')];
        hold.forEach((h) => { const r = rates[h.asset]; lines.push([h.asset, h.qty, r ? r.chf : '', r ? (h.qty * r.chf).toFixed(2) : '', r ? r.source : ''].join(';')); });
        lines.push(['Total', '', '', total.toFixed(2), ''].join(';'));
        download(`Crypto_Steuerbericht_${y}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv');
      }
      if (b.dataset.act === 'print') printReport(y, hold, rates, total, !!snap);
    }),
  };
}
const nrp = (v) => price(v).replace('CHF ', '');

function openRate(y, sym) {
  const t = ty(y); const r = t.rates[sym] || {};
  openSheet({
    title: `Steuerkurs ${sym}`,
    render: () => `<div class="small mut">Kurs per 31.12.${y} in CHF. Quelle zuerst ESTV ICTax, sonst Jahresendkurs der Plattform.</div>
      <label class="field"><span>Kurs CHF</span><input name="v" inputmode="decimal" value="${esc(r.chf ?? '')}"></label>
      <div class="lbl">Quelle</div>${chips('src', [['ESTV', 'ESTV ICTax'], ['BingX 31.12.', 'BingX 31.12.'], ['Relai 31.12.', 'Relai 31.12.'], ['Einstandspreis', 'Einstandspreis'], [r.source || 'Andere', r.source || 'Andere']], r.source || 'ESTV')}
      <button class="btn gold block big mt" data-act="save">Speichern</button>${r.chf != null ? '<button class="btn danger block" data-act="del">Entfernen</button>' : ''}`,
    bind: (el) => el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'del') delete t.rates[sym];
      else { const v = Number(el.querySelector('[name=v]').value.replace(/['’]/g, '').replace(',', '.')); if (!(v >= 0)) return toast('Kurs eingeben'); t.rates[sym] = { chf: v, source: chipVal(el, 'src') || 'ESTV' }; }
      commit(); closeSheet();
    }),
  });
}

function printReport(y, hold, rates, total, closed) {
  const s = S();
  const rows = hold.map((h) => { const r = rates[h.asset]; return `<tr><td>${esc(h.asset)}</td><td class="r">${qty(h.qty)}</td><td class="r">${r ? nrp(r.chf) : '–'}</td><td class="r">${r ? chf(h.qty * r.chf, 2) : '–'}</td><td>${r ? esc(r.source) : 'fehlt'}</td></tr>`; }).join('');
  document.getElementById('print').innerHTML = `
    <div class="pr"><div class="prh">FINANCE VAULT · CRYPTO-STEUERBERICHT</div><h1>Steuerjahr ${y}</h1>
    <p>${esc(s.settings.name)} · Kanton ${esc(s.settings.canton)} · Privatvermögen · Stichtag 31.12.${y}, 23:59 Uhr${closed ? ' · abgeschlossen' : ' · Entwurf'}</p>
    <table><thead><tr><th>Asset</th><th class="r">Bestand</th><th class="r">Steuerkurs CHF</th><th class="r">Steuerwert</th><th>Kursquelle</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3"><b>Total Kryptowährungen</b></td><td class="r"><b>${chf(total, 2)}</b></td><td></td></tr></tfoot></table>
    <p>Eintragen im Wertschriften- und Guthabenverzeichnis (E-Tax BL, Ziffer 800), je Coin als eigene Position. Bestand rekonstruiert aus ${s.transactions.length} erfassten Transaktionen. Kurse mit Quelle «ESTV» stammen aus der ESTV-Kursliste (ICTax), übrige sind Ersatzkurse.</p>
    <p class="small">Erstellt am ${dmy(new Date())} mit Finance Vault. Organisationshilfe, keine Steuerberatung.</p></div>`;
  setTimeout(() => window.print(), 50);
}

// =====================================================================
// RECHNUNGEN
// =====================================================================
export function invoices() {
  const s = S(); const q = ui.invSearch.toLowerCase();
  const match = (i) => !q || `${i.issuer} ${i.title} ${i.number} ${i.category} ${i.amount}`.toLowerCase().includes(q);
  const open = s.invoices.filter((i) => i.status === 'open' && match(i)).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
  const paid = s.invoices.filter((i) => i.status === 'paid' && match(i)).sort((a, b) => (b.paidAt || '') < (a.paidAt || '') ? -1 : 1);
  const sum = open.reduce((a, i) => a + (+i.amount || 0), 0);
  const row = (i) => {
    const d = i.due ? daysUntil(i.due) : null;
    const st = i.status === 'paid' ? `<span class="pos">bezahlt ${dmy(i.paidAt)}</span>` : d == null ? '<span class="mut">ohne Fälligkeit</span>' : d < 0 ? `<span class="neg">überfällig seit ${-d} Tag${d === -1 ? '' : 'en'}</span>` : d === 0 ? '<span class="amber">heute fällig</span>' : `<span class="${d <= 7 ? 'amber' : 'mut'}">fällig in ${d} Tag${d === 1 ? '' : 'en'} · ${dmyShort(i.due)}</span>`;
    return `<div class="card row clickable" data-inv="${i.id}">${i.status === 'paid' ? icon('ok') : `<i class="dotc ${d != null && d < 0 ? 'red' : d != null && d <= 7 ? 'amber' : 'mut'}"></i>`}
      <div class="grow"><b>${esc(i.issuer)}</b>${i.title ? ` <span class="small mut">· ${esc(i.title)}</span>` : ''}<div class="small">${st}${i.file ? ' · 📎' : ''}</div></div><b class="${i.status === 'paid' ? 'mut' : ''}">${chf(+i.amount, 2)}</b></div>`;
  };
  return {
    title: 'Rechnungen', sub: `${open.length} offen · ${chf(sum, 2)}`,
    html: `<input class="search" data-search placeholder="Suchen: Aussteller, Nummer, Betrag …" value="${esc(ui.invSearch)}">
      <button class="btn gold block" data-act="add">＋ Rechnung erfassen</button>
      <div class="lbl mt">Offen · ${chf(sum, 2)}</div>${open.map(row).join('') || '<div class="card mut small">Keine offenen Rechnungen</div>'}
      <div class="lbl mt">Bezahlt</div>${paid.map(row).join('') || '<div class="card mut small">Noch keine</div>'}
      <div class="small mut mt">Erinnerungen per Push folgen in Phase 2. Bis dahin: in der Rechnung «In Kalender» tippen, dann erinnert dich der iPhone-Kalender.</div>`,
    bind: (el) => {
      const sI = el.querySelector('[data-search]');
      sI.addEventListener('input', () => { ui.invSearch = sI.value; dispatchEvent(new Event('rerender')); const n = document.querySelector('[data-search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      el.addEventListener('click', (e) => {
        const i = e.target.closest('[data-inv]'); if (i) return openInvoice(S().invoices.find((q) => q.id === i.dataset.inv));
        if (e.target.closest('[data-act=add]')) openInvoice();
      });
    },
  };
}

export function openInvoice(inv = null) {
  const d = inv ? { ...inv } : { issuer: '', title: '', number: '', amount: '', due: '', category: '', tax: 'no', ziffer: '', status: 'open', paidAt: '', note: '' };
  let newFile = null;
  const capture = (el) => {
    const v = (n) => el.querySelector(`[name=${n}]`)?.value ?? '';
    Object.assign(d, { issuer: v('issuer'), title: v('title'), number: v('number'), amount: v('amount'), due: v('due'), category: v('category'), ziffer: v('ziffer'), note: v('note'), paidAt: v('paidAt'), tax: chipVal(el, 'tax') || d.tax });
  };
  openSheet({
    title: inv ? inv.issuer : 'Neue Rechnung', capture,
    render: () => `
      ${inv ? `<div class="card ${d.status === 'paid' ? 'goldb' : ''}"><div class="row"><div class="grow"><div class="serif big2">${chf(+d.amount, 2)}</div>
        <div class="small ${d.status === 'paid' ? 'pos' : 'amber'}">${d.status === 'paid' ? 'BEZAHLT am ' + dmy(d.paidAt) : 'Offen' + (d.due ? ' · fällig ' + dmy(d.due) : '')}</div></div>
        ${d.status === 'open' ? '<button class="btn gold sm" data-act="paid">✓ Bezahlt</button>' : '<button class="btn line sm" data-act="unpaid">Wieder offen</button>'}</div></div>` : ''}
      <label class="field"><span>Aussteller *</span><input name="issuer" value="${esc(d.issuer)}" placeholder="z. B. TEKO Basel"></label>
      <div class="grid2">
        <label class="field"><span>Bezeichnung</span><input name="title" value="${esc(d.title)}"></label>
        <label class="field"><span>Rechnungsnummer</span><input name="number" value="${esc(d.number)}"></label>
        <label class="field"><span>Betrag CHF *</span><input name="amount" inputmode="decimal" value="${esc(d.amount)}"></label>
        <label class="field"><span>Fällig am</span><input name="due" type="date" value="${esc(d.due)}"></label>
        <label class="field"><span>Kategorie</span><input name="category" value="${esc(d.category)}" placeholder="Studium, Wohnen …" list="cats"></label>
        ${d.status === 'paid' ? `<label class="field"><span>Bezahlt am</span><input name="paidAt" type="date" value="${esc(d.paidAt)}"></label>` : '<span></span>'}
      </div>
      <datalist id="cats">${['Studium', 'Wohnen', 'Versicherung', 'Gesundheit', 'Mobilität', 'Kommunikation', 'Steuern', 'Abos', 'Sonstiges'].map((c) => `<option value="${c}">`).join('')}</datalist>
      <div class="lbl">Steuer</div>${chips('tax', [['no', 'nicht relevant'], ['maybe', 'möglicherweise'], ['yes', 'steuerrelevant']], d.tax)}
      <label class="field"><span>E-Tax-Ziffer (z. B. 650 Weiterbildung, 720 Krankheit)</span><input name="ziffer" value="${esc(d.ziffer)}" inputmode="numeric"></label>
      <label class="field"><span>Notiz</span><input name="note" value="${esc(d.note || '')}"></label>
      <div class="lbl">Beleg (Foto oder PDF)</div>
      <label class="btn line block">📷 ${inv && inv.file ? 'Beleg ersetzen' : 'Foto / PDF hinzufügen'}<input type="file" name="file" accept="image/*,application/pdf" hidden></label>
      <div class="small mut" data-fname>${inv && inv.file ? 'Beleg gespeichert (verschlüsselt): ' + esc(inv.fileName || '') : ''}</div>
      ${inv && inv.file ? '<button class="btn line block" data-act="view">Beleg anzeigen</button>' : ''}
      ${d.due && d.status === 'open' ? '<button class="btn line block" data-act="ics">In Kalender (Erinnerung)</button>' : ''}
      <button class="btn gold block big mt" data-act="save">Speichern</button>
      ${inv ? '<button class="btn danger block" data-act="del">Löschen</button>' : ''}`,
    bind: (el) => {
      el.querySelector('[name=file]').addEventListener('change', (e) => { newFile = e.target.files[0]; el.querySelector('[data-fname]').textContent = newFile ? 'Neu: ' + newFile.name : ''; });
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return; const s = S();
        capture(el);
        if (b.dataset.act === 'paid') { d.status = 'paid'; d.paidAt = isoDay(new Date()); rerender(); return; }
        if (b.dataset.act === 'unpaid') { d.status = 'open'; d.paidAt = ''; rerender(); return; }
        if (b.dataset.act === 'view') { const u = await getFileURL(inv.file); if (u) window.open(u, '_blank'); return; }
        if (b.dataset.act === 'ics') return downloadICS(d);
        if (b.dataset.act === 'del') {
          if (!confirm('Rechnung löschen?')) return;
          if (inv.file) await deleteFile(inv.file);
          s.invoices = s.invoices.filter((q) => q.id !== inv.id); commit(); closeSheet(); return;
        }
        const amount = Number(String(d.amount).replace(/['’]/g, '').replace(',', '.'));
        if (!d.issuer.trim() || !(amount >= 0)) return toast('Aussteller und Betrag angeben');
        const o = { ...d, issuer: d.issuer.trim(), amount };
        if (newFile) { const fid = uid(); await putFile(fid, newFile); if (inv && inv.file) await deleteFile(inv.file); o.file = fid; o.fileName = newFile.name; }
        if (inv) Object.assign(inv, o); else s.invoices.push({ id: uid(), created: new Date().toISOString(), ...o });
        commit(); toast(o.status === 'paid' ? 'Als bezahlt gespeichert' : 'Gespeichert'); closeSheet();
      });
    },
  });
}

function downloadICS(d) {
  const ds = d.due.replace(/-/g, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finance Vault//DE', 'BEGIN:VEVENT', `UID:${uid()}@financevault`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${ds}`, 'SUMMARY:Rechnung fällig (Finance Vault)',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Eine Rechnung ist fällig', 'TRIGGER:-P2D', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download('rechnung-faellig.ics', ics, 'text/calendar');
}

// =====================================================================
// VAULT
// =====================================================================
const SOURCES = [
  ['Relai', 'CSV-Export der Auftragshistorie', 'Relai › Profil › Transaktionen › Export › CSV', 35],
  ['BingX', 'Transaction History und Spot Trade History', 'BingX › Assets › Order/Transaction History › Export (max. 1 Jahr pro Export)', 35],
];
export function vault(sub) {
  if (sub === 'pruefen') return reviewPage();
  if (sub === 'einstellungen') return settingsPage();
  const s = S();
  const status = (name, maxDays) => {
    const im = s.imports[name]; if (!im) return '<span class="mut">noch nie importiert</span>';
    const d = Math.floor((Date.now() - new Date(im.last)) / 864e5);
    return `<span class="${d <= maxDays ? 'pos' : d <= maxDays * 2 ? 'amber' : 'neg'}">● Import ${ago(im.last)} · ${im.count} Transaktionen</span>`;
  };
  const others = Object.keys(s.imports).filter((k) => !SOURCES.some((x) => x[0] === k));
  const rc = s.transactions.filter((t) => t.type === 'review').length;
  return {
    title: 'Vault', sub: 'Import-Zentrale · du lieferst Rohdaten, Finance Vault rechnet',
    html: `
    ${rc ? `<div class="card row clickable goldb" data-go="#/vault/pruefen">${icon('warn')}<div class="grow"><b>${rc} Transaktion${rc > 1 ? 'en' : ''} zuordnen</b><div class="small mut">Lieber einmal fragen als falsch rechnen</div></div><span class="gold">›</span></div>` : ''}
    ${SOURCES.map(([n, d, how, max]) => `<div class="card"><div class="row"><div class="grow"><b class="big1">${n}</b><div class="small mut">${d}</div></div>
      <label class="btn line sm">Importieren<input type="file" accept=".csv,text/csv,text/plain" data-import="${n}" hidden></label></div>
      <div class="small mt">${status(n, max)}</div><div class="small mut">So geht's: ${how}</div></div>`).join('')}
    ${others.map((n) => `<div class="card row"><div class="grow"><b>${esc(n)}</b><div class="small">${status(n, 60)}</div></div><label class="btn line sm">Importieren<input type="file" accept=".csv,text/csv,text/plain" data-import="${esc(n)}" hidden></label></div>`).join('')}
    <div class="card row"><div class="grow"><b>Andere Plattform</b><div class="small mut">Beliebige CSV mit Spalten-Zuordnung</div></div><label class="btn line sm">CSV wählen<input type="file" accept=".csv,text/csv,text/plain" data-import="" hidden></label></div>
    <div class="card row"><div class="grow"><b>Ledger</b><div class="small mut">Öffentliche Adressen, automatischer Bestand · folgt in Phase 4</div></div><span class="tag">bald</span></div>
    <div class="card row"><div class="grow"><b>VIAC, Bank</b><div class="small mut">Stand unter Invest › Konten aktualisieren</div></div><button class="btn line sm" data-go="#/invest">Konten</button></div>
    <div class="small mut">Nur CSV. XLSX bitte in Excel/Numbers als CSV speichern. Doppelte Transaktionen werden automatisch erkannt und ignoriert.</div>
    <button class="btn line block mt" data-go="#/vault/einstellungen">⚙️ Einstellungen, Backup, PIN</button>`,
    bind: (el) => el.querySelectorAll('[data-import]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      try { openImport(await f.text(), inp.dataset.import, f.name); } catch (e) { toast('Datei konnte nicht gelesen werden'); }
      inp.value = '';
    })),
  };
}

// ---------- Import-Assistent ----------
function openImport(text, platform, fname) {
  const parsed = parseCSV(text);
  const s = S();
  const sig = parsed.headers.join('|');
  const saved = platform && s.imports[platform] && s.imports[platform].sig === sig ? s.imports[platform].mapping : null;
  const st = {
    platform: platform || fname.replace(/\.[^.]+$/, '').split(/[_\-\s]/)[0] || 'Import',
    mapping: saved ? { ...saved.mapping } : guessMapping(parsed.headers),
    defaultQuote: saved ? saved.defaultQuote : platform === 'Relai' ? 'CHF' : 'USDT',
    defaultAsset: saved ? saved.defaultAsset : platform === 'Relai' ? 'BTC' : '',
    trackQuote: saved ? saved.trackQuote : true,
    sample: [], checked: null,
  };
  const capture = (el) => {
    for (const [r] of ROLES) { const v = el.querySelector(`[name=m_${r}]`)?.value; if (v !== undefined) st.mapping[r] = v === '' ? undefined : +v; }
    st.platform = el.querySelector('[name=platform]')?.value.trim() || st.platform;
    st.defaultQuote = el.querySelector('[name=dq]')?.value.trim().toUpperCase() || 'CHF';
    st.defaultAsset = el.querySelector('[name=da]')?.value.trim().toUpperCase() || '';
    st.trackQuote = !!el.querySelector('[name=tq]')?.checked;
  };
  const opts = () => ({ platform: st.platform, defaultQuote: st.defaultQuote, defaultAsset: st.defaultAsset, trackQuote: st.trackQuote });
  const refreshSample = async (el) => {
    const r = await interpret({ ...parsed, rows: parsed.rows.slice(0, 6) }, st.mapping, opts());
    st.sample = r.records;
    const box = el.querySelector('[data-sample]');
    if (box) box.innerHTML = sampleHTML();
  };
  const sampleHTML = () => st.sample.length ? st.sample.map((r) => `<div class="txr"><i class="dotc ${TYPES[{ deposit: 'transfer', withdraw: 'transfer' }[r.kind] || r.kind]?.c || 'amber'}"></i>
    <div class="grow small"><b>${{ buy: 'Kauf', sell: 'Verkauf', deposit: 'Einzahlung', withdraw: 'Auszahlung', transfer: 'Transfer', reward: 'Reward', fee: 'Gebühr', review: 'Unklar' }[r.kind]}</b> ${qty(r.amount)} ${esc(r.asset)}
    <div class="mut">${dmyShort(r.date)} · ${r.chf != null ? 'CHF ' + r.chf : r.total != null ? r.quote + ' ' + qty(r.total) : 'ohne Betrag'}${r.fee ? ' · Gebühr ' + r.fee + ' ' + (r.feeAsset || '') : ''}</div></div></div>`).join('')
    : '<div class="small amber">Keine Zeile erkannt. Bitte Datum, Coin (oder Paar) und Menge zuordnen.</div>';
  openSheet({
    title: 'Import ' + st.platform, capture,
    render: () => `
      <div class="small mut">${esc(fname)} · ${parsed.rows.length} Zeilen · ${parsed.headers.length} Spalten${saved ? ' · gespeicherte Zuordnung verwendet' : ''}</div>
      <label class="field mt"><span>Plattform</span><input name="platform" value="${esc(st.platform)}"></label>
      <div class="lbl">Spalten zuordnen</div>
      <div class="grid2">${ROLES.map(([r, l]) => `<label class="field"><span>${l}</span><select name="m_${r}"><option value="">–</option>${parsed.headers.map((h, i) => `<option value="${i}" ${st.mapping[r] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>
      <div class="grid2">
        <label class="field"><span>Gegenwährung falls keine Spalte</span><input name="dq" value="${esc(st.defaultQuote)}"></label>
        <label class="field"><span>Coin falls keine Spalte</span><input name="da" value="${esc(st.defaultAsset)}" placeholder="z. B. BTC bei Relai"></label>
      </div>
      <label class="check"><input type="checkbox" name="tq" ${st.trackQuote ? 'checked' : ''}> Stablecoins/Gegen-Coins (z. B. USDT) als eigenen Bestand mitführen</label>
      <div class="lbl mt">Vorschau (erste Zeilen)</div><div class="card" data-sample>${sampleHTML()}</div>
      ${st.checked ? `<div class="card goldb"><b class="gold">${esc(st.platform)}-Import geprüft</b><div class="small">${st.checked.read} gelesen · ${st.checked.dup} schon vorhanden · <b>${st.checked.fresh.length} neu</b>${st.checked.errors ? ' · ' + st.checked.errors + ' unlesbar' : ''}</div>
        ${st.checked.review ? `<div class="small amber">${st.checked.review} davon unklar, du wirst danach gefragt</div>` : ''}<div class="small mut">Doppelte Transaktionen werden ignoriert. Für Käufe in USDT werden historische CHF-Kurse geladen.</div></div>
        <button class="btn gold block big" data-act="go" ${st.checked.fresh.length ? '' : 'disabled'}>${st.checked.fresh.length} Transaktionen importieren</button>`
        : '<button class="btn gold block big mt" data-act="check">Prüfen</button>'}
      <div class="small mut mt" data-prog></div>`,
    bind: (el) => {
      el.querySelectorAll('select, input').forEach((i) => i.addEventListener('change', () => { capture(el); st.checked = null; refreshSample(el); }));
      if (!st.sample.length) refreshSample(el);
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        capture(el);
        if (b.dataset.act === 'check') {
          const r = await interpret(parsed, st.mapping, opts());
          const p = preview(r.records);
          st.checked = { read: r.records.length, errors: r.errors, ...p }; rerender(); return;
        }
        if (b.dataset.act === 'go') {
          b.disabled = true;
          const prog = el.querySelector('[data-prog]');
          const { txs, missing } = await toTransactions(st.checked.fresh, opts(), (i, n) => { prog.textContent = `Verarbeite ${i} / ${n} …`; });
          s.transactions.push(...txs);
          s.imports[st.platform] = { last: new Date().toISOString(), count: (s.imports[st.platform]?.count || 0) + st.checked.fresh.length, sig,
            mapping: { mapping: st.mapping, defaultQuote: st.defaultQuote, defaultAsset: st.defaultAsset, trackQuote: st.trackQuote } };
          commit(); closeAll();
          toast(`${st.checked.fresh.length} importiert${missing ? ` · ${missing} ohne CHF-Wert` : ''}`, 4000);
          dispatchEvent(new Event('refreshprices'));
        }
      });
    },
  });
}

// ---------- Prüfen ----------
function reviewPage() {
  const list = S().transactions.filter((t) => t.type === 'review');
  return {
    title: 'Bitte zuordnen', sub: 'Lieber einmal fragen als falsch rechnen',
    html: list.map((t) => `<div class="card clickable" data-tx="${t.id}">${icon('warn')} <b>${qty(t.amount)} ${esc(t.asset)}</b> <span class="small mut">${esc(t.platform)} · ${dmy(t.date)}</span>
      <div class="small mut">${esc(t.raw || t.note || '')}</div></div>`).join('') || '<div class="card">Alles zugeordnet 👍</div>',
    bind: (el) => el.addEventListener('click', (e) => { const c = e.target.closest('[data-tx]'); if (c) import('./views-main.js').then((m) => m.openTx(S().transactions.find((q) => q.id === c.dataset.tx))); }),
  };
}

// ---------- Einstellungen ----------
function settingsPage() {
  const s = S().settings;
  return {
    title: 'Einstellungen', sub: 'Backup, PIN, Kurse',
    html: `
    <label class="field"><span>Dein Name</span><input data-set="name" value="${esc(s.name)}"></label>
    <label class="field"><span>Standard-Wallet für Auszahlungen</span><input data-set="defaultWallet" value="${esc(s.defaultWallet)}"></label>
    <label class="field"><span>Automatisch sperren nach (Minuten)</span><input data-set="autoLockMin" type="number" value="${s.autoLockMin}"></label>
    <label class="field"><span>CoinGecko Demo-API-Key (optional, für mehr Abfragen)</span><input data-set="cgKey" value="${esc(s.cgKey)}" placeholder="CG-…"></label>
    <div class="lbl mt">Backup</div>
    <div class="card small mut">Das Backup bleibt verschlüsselt und ist nur mit deinem PIN lesbar. Speichere es z. B. in «Dateien». Ohne Backup sind die Daten bei Verlust des iPhones weg.</div>
    <div class="grid2"><button class="btn gold" data-act="backup">⬇ Backup exportieren</button><label class="btn line">⬆ Backup laden<input type="file" data-act="restore" accept=".json,application/json" hidden></label></div>
    <div class="lbl mt">Sicherheit</div>
    <div class="grid2"><button class="btn line" data-act="pin">PIN ändern</button><button class="btn line" data-act="lock">Jetzt sperren</button></div>
    <div class="lbl mt">Daten</div>
    <div class="grid2"><button class="btn line" data-act="demo">Demo-Daten laden</button><button class="btn line" data-act="goals">Standard-Ziele</button></div>
    <button class="btn danger block mt" data-act="wipe">Alles löschen</button>
    <div class="small mut center mt">Finance Vault v1.0 · Phase 1 · ${S().transactions.length} Transaktionen · ${S().invoices.length} Rechnungen</div>`,
    bind: (el) => {
      el.querySelectorAll('[data-set]').forEach((i) => i.addEventListener('change', () => { s[i.dataset.set] = i.type === 'number' ? Number(i.value) || 5 : i.value.trim(); commit(); toast('Gespeichert'); }));
      el.querySelector('[data-act=restore]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (!confirm('Alle aktuellen Daten durch das Backup ersetzen? Danach mit dem PIN des Backups entsperren.')) return;
        try { await importBackup(await f.text()); location.reload(); } catch (err) { toast('Ungültiges Backup'); }
      });
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-act]'); if (!b) return;
        const a = b.dataset.act;
        if (a === 'backup') { await flush(); download(`FinanceVault_Backup_${isoDay(new Date())}.json`, await exportBackup()); }
        if (a === 'lock') { await flush(); lock(); location.reload(); }
        if (a === 'pin') {
          const o = prompt('Aktueller PIN'); if (!o) return;
          const n = prompt('Neuer PIN (mind. 6 Ziffern)'); if (!n || n.length < 6) return toast('Mindestens 6 Zeichen');
          if (prompt('Neuen PIN wiederholen') !== n) return toast('PINs stimmen nicht überein');
          toast('Bitte warten …'); toast((await changePin(o, n, S())) ? 'PIN geändert' : 'Aktueller PIN falsch');
        }
        if (a === 'demo' && confirm('Demo-Daten laden? Deine aktuellen Daten werden ersetzt.')) { setState(demoState()); commit(); location.hash = '#/'; toast('Demo-Daten geladen'); dispatchEvent(new Event('refreshprices')); }
        if (a === 'goals' && confirm('Standard-Ziele hinzufügen?')) { S().goals.push(...defaultGoals(S())); commit(); toast('Ziele hinzugefügt'); }
        if (a === 'wipe' && confirm('Wirklich ALLES löschen?') && prompt('Zur Bestätigung LÖSCHEN eintippen') === 'LÖSCHEN') { await wipeAll(); location.reload(); }
      });
    },
  };
}
