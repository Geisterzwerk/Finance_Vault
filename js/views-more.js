// =====================================================================
// views-more.js – Steuern, Rechnungen, Vault (Import, Prüfen, Einstellungen)
// =====================================================================
import { S, commit, flush, uid, setState, demoState, defaultGoals } from './store.js';
import { yearEndHoldings, reviewCount, hiddenAssets } from './calc.js';
import { historicalCHF } from './prices.js';
import { parseCSV, guessMapping, interpret, preview, toTransactions, ROLES } from './importer.js';
import * as BX from './bingx.js';
import { putFile, getFileURL, deleteFile, exportBackup, importBackup, backupInfo, wipeAll, changePin, lock } from './vault.js';
import { APP_VERSION } from './version.js';
import {
  esc, chf, qty, price, dmy, dmyShort, ago, daysUntil, isoDay, icon, openSheet, closeSheet, closeAll,
  toast, download, chips, chipVal, rerender,
} from './ui.js';
import { openTx } from './views-main.js';
import { inboxPage, documentsPage, ledgerPage, openScanner, taxExtrasHTML, bindTaxExtras } from './views-docs.js';
import { remindersICS, TAX_KINDS, buildPackage, reportHTML } from './taxpack.js';
import * as TC from './taxcal.js';
import * as TD from './taxdocs.js';
import { fmtRef } from './scan.js';
import { progress, SLOTS } from './charts.js';
import * as SRV from './server.js';
import { autoResolve } from './auto.js';

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
const nrp = (v) => price(v).replace('CHF ', '');

// =====================================================================
// STEUERN
// =====================================================================
const fmtDay = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const inDays = (n) => (n < 0 ? `seit ${-n} Tag${n === -1 ? '' : 'en'} überfällig` : n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`);
function taxCalendarHTML() {
  const items = TC.calendar(); const plan = TC.reservePlan(); const c = TC.cfg();
  const row = (x) => {
    const ic = x.done ? icon('ok') : x.status === 'over' ? icon('bad') : x.status === 'soon' ? icon('warn') : '<span class="ic empty"></span>';
    if (x.type === 'file') {
      return `<div class="tcal" data-cal="${x.id}"><div class="row">${ic}<div class="grow"><b>${x.title}</b>
        <div class="small ${x.done ? 'pos' : x.status === 'over' ? 'neg' : x.status === 'soon' ? 'amber' : 'mut'}">${x.done ? 'eingereicht' + (x.filedAt ? ' am ' + dmy(x.filedAt) : '') : `bis ${fmtDay(x.due)} · ${inDays(x.days)}${x.due === x.ordinary ? ` · stillschweigend verlängert bis ${fmtDay(x.ext)}` : ' (verlängerte Frist)'}`}</div></div></div>
        ${x.done ? '' : `<div class="qbtns"><button class="btn line sm" data-cal-act="filed" data-y="${x.year}">✓ Eingereicht</button><button class="btn sm" data-cal-act="ext" data-y="${x.year}">Frist verlängern …</button></div>`}</div>`;
    }
    const pct = x.soll > 0 ? x.paid / x.soll : 0; const ei = TC.earlyInterest(x); const li = TC.lateInterest(x);
    return `<div class="tcal" data-cal="${x.id}"><div class="row">${progress(x.done ? 1 : pct, x.done ? SLOTS[2] : SLOTS[0], 40)}<div class="grow"><b>${esc(x.title)}</b>
      <div class="small ${x.done ? 'pos' : x.status === 'over' ? 'neg' : x.status === 'soon' ? 'amber' : 'mut'}">${x.done ? 'bezahlt' : `bis ${fmtDay(x.due)} · ${inDays(x.days)}`}${x.stage === 'definitiv' ? ' · definitiv' : x.stage === 'provisorisch' ? ' · provisorisch' : ''}</div></div>
      <div class="right"><b>${x.invoices.length ? chf(x.open, 2) : x.estimate ? '≈ ' + chf(x.estimate) : '–'}</b><div class="small mut">${x.done ? chf(x.soll, 2) : x.invoices.length ? 'offen' : x.estimate ? 'Schätzung Vorjahr' : 'Rechnung fehlt'}</div></div></div>
      ${ei >= 1 ? `<div class="small mut">Heute bezahlt: ≈ ${chf(ei, 2)} Vergütungszins (${TC.KIND_LABEL[x.kind] && x.kind === 'Bund' ? c.vzBund : c.vzStaat} %).</div>` : ''}
      ${li >= 1 ? `<div class="small neg">Verzugszins bisher ≈ ${chf(li, 2)} – bald bezahlen.</div>` : ''}
      ${x.done ? '' : `<div class="qbtns">${x.invoices.length ? x.invoices.filter((i) => i.status !== 'paid').map((i) => `<button class="btn line sm" data-cal-act="pay" data-inv="${i.id}">✓ ${esc(i.taxStage === 'definitiv' ? 'Definitiv' : 'Rechnung')} ${chf(+i.amount)} bezahlt</button>`).join('') : ''}
        <button class="btn sm" data-cal-act="addinv" data-kind="${esc(x.kind)}" data-y="${x.year}">＋ Rechnung erfassen</button></div>`}</div>`;
  };
  return `<div class="lbl mt">Steuerkalender</div><div class="card">${items.map(row).join('')}
    <div class="small mut mt">Fristen Kanton Basel-Landschaft ${c.ratesYear} – jährlich auf steuern.bl.ch prüfen. Gemeindesteuer ${c.gemeindeSeparate ? `separat, fällig ${c.gemeindeDue.slice(3)}.${c.gemeindeDue.slice(0, 2)}.` : 'mit der Staatssteuer'} (<a class="link sm" data-cal-act="settings">ändern</a>).</div></div>
  ${plan.total > 0 ? `<div class="lbl mt">Rücklage</div><div class="card"><div class="row">${progress(plan.coverage ?? 0, SLOTS[2], 54)}<div class="grow">
      <div class="big2">${plan.missing > 0 ? chf(Math.ceil(plan.monthly / 10) * 10) + ' / Monat' : 'Gedeckt'}</div>
      <div class="small mut">${plan.missing > 0 ? `zurücklegen, damit ${chf(plan.total)} offene Steuern rechtzeitig bezahlt sind` : `Rücklage deckt alle offenen Steuern (${chf(plan.total)})`}</div></div></div>
    ${plan.rows.map((r) => `<div class="txr"><span class="grow small">${esc(r.title)} <span class="mut">· ${fmtDay(r.due)}</span></span><span class="small mut">${r.months} Mt.</span><b class="small">${chf(r.perMonth)} / Mt.</b></div>`).join('')}
    <label class="field mt"><span>Rücklage-Konto (optional)</span><select data-reserve><option value="">– keins –</option>${S().accounts.filter((a) => a.kind !== 'liability').map((a) => `<option value="${a.id}" ${a.id === c.reserveAccountId ? 'selected' : ''}>${esc(a.name)} · ${chf(a.value)}</option>`).join('')}</select></label>
    <div class="small mut">Tipp: ein eigenes Sparkonto für Steuern und einen Dauerauftrag in dieser Höhe einrichten.</div></div>` : ''}`;
}
// ---------- Steuermappe ----------
const fmtV = (v) => (v == null || v === '' ? '–' : chf(+v));
function mappeHTML(y) {
  const items = TD.mappe(y); const tot = TD.totals(items); const pr = TD.progressOf(items);
  const areas = [...new Set(items.map((i) => i.area))];
  const st = (i) => (i.status === 'eingetragen' ? icon('ok') : i.status === 'da' ? '<span class="ic half">✓</span>' : i.status === 'nicht' ? '<span class="ic empty">–</span>' : '<span class="ic empty"></span>');
  const valTxt = (i) => (!i.value ? (i.prev ? `<span class="mut">${i.prev.year}: ${fmtV(i.prev.staat)}</span>` : '') : i.value.staat === i.value.bund || i.value.bund == null ? `${i.value.estimate ? '≈ ' : ''}${fmtV(i.value.staat)}` : `${fmtV(i.value.staat)} / ${fmtV(i.value.bund)}`);
  const missing = items.filter((i) => i.status === 'fehlt');
  return `<div class="card">
      <div class="row">${progress(pr, SLOTS[2], 54)}<div class="grow"><div class="big2">${items.filter((i) => i.status === 'eingetragen').length} von ${items.filter((i) => i.status !== 'nicht').length} eingetragen</div>
        <div class="small mut">${missing.length ? `Es fehlen noch: ${esc(missing.slice(0, 3).map((i) => i.label).join(', '))}${missing.length > 3 ? ' …' : ''}` : 'Alle Belege beisammen'}</div></div></div>
      <label class="btn gold block mt">⬆ Belege hochladen (mehrere PDFs)<input type="file" multiple accept="application/pdf,image/*" data-mappe="upload" hidden></label>
      <div class="small mut">Lohnausweis, 3a-Bescheinigung, Steuerauszüge (BLKB, VIAC, Raiffeisen …), E-Tax-Brief, alte Steuererklärung – Finance Vault erkennt den Beleg, liest die Beträge aus und legt ihn verschlüsselt ab.</div>
    </div>
    ${areas.map((a) => `<div class="small mut gl">${esc(a)}</div><div class="card">${items.filter((i) => i.area === a).map((i) => `
      <div class="txr clickable" data-mi="${esc(i.id)}">${st(i)}<div class="grow"><b class="${i.status === 'nicht' ? 'mut' : ''}">${esc(i.label)}</b>
        <div class="small mut">${i.ziffer ? 'Ziff. ' + i.ziffer + ' · ' : ''}${esc(i.source)}${i.docs.length ? ` · 📎 ${i.docs.length}` : i.status === 'fehlt' && i.when !== '–' ? ' · erwartet ' + esc(i.when) : ''}</div></div>
        <span class="small right">${valTxt(i)}</span><span class="chev">›</span></div>`).join('')}</div>`).join('')}
    <div class="lbl mt">Übertrag Seite 4 / Wertschriftenverzeichnis</div>
    <div class="card"><div class="txr"><span class="grow">Ziff. 800 Wertschriften und Guthaben</span><b>${tot.estimate ? '≈ ' : ''}${chf(tot[800])}</b></div>
      <div class="txr"><span class="grow">Ziff. 300 Erträge</span><b>${chf(tot[300])}</b></div>
      <div class="txr"><span class="grow">Ziff. 970 Bruttoertrag A</span><b>${chf(tot[970])}</b></div>
      <div class="txr"><span class="grow">Ziff. 972 Verrechnungssteuer-Anspruch</span><b>${chf(tot[972], 2)}</b></div>
      ${tot.estimate ? '<div class="small amber mt">≈ enthält Schätzungen (Steuerauszug oder Steuerkurs fehlt).</div>' : ''}
      <div class="small mut mt">Tipp: In E-Tax BL kannst du E-Steuerauszüge direkt importieren (Wertschriftenverzeichnis › E-Steuerauszug). Dann nur noch die Crypto-Zeilen von Hand.</div></div>
    <button class="btn line block" data-mappe="report">📄 Bericht «Was trage ich wo ein»</button>`;
}
async function uploadMappe(files, y, item = null) {
  const res = [];
  for (const f of files) { try { res.push(await TD.ingest(f, y, item)); } catch (e) { console.error(e); toast('Konnte ' + f.name + ' nicht lesen'); } }
  commit();
  const names = res.map((d) => d.docType === 'erklaerung' ? `Steuererklärung ${d.year} (${d.extract.ziffern} Ziffern übernommen)` : d.docType === 'info' ? `${d.fileName}: nicht nötig, abgelegt` : d.title + (d.extract && d.extract.steuerwert != null ? ` · Steuerwert ${chf(d.extract.steuerwert)}` : d.extract && d.extract.nettolohn ? ` · Nettolohn ${chf(d.extract.nettolohn)}` : d.extract && d.extract.total ? ` · ${chf(d.extract.total)}` : ''));
  if (names.length) openSheet({ title: 'Belege eingelesen', render: () => `${res.map((d, k) => `<div class="txr">${d.taxItem || d.docType === 'erklaerung' ? icon('ok') : icon('warn')}<span class="grow small">${esc(names[k])}${d.year !== y ? ` <span class="tag">${d.year}</span>` : ''}${!d.taxItem && d.docType !== 'erklaerung' ? '<div class="amber">Nicht erkannt – in der Mappe einer Position zuordnen</div>' : ''}</span></div>`).join('')}
    <div class="small mut mt">Die Beträge sind übernommen. Prüfe sie kurz in der jeweiligen Position.</div><button class="btn gold block mt" data-act="ok">OK</button>`, bind: (el) => el.querySelector('[data-act=ok]').addEventListener('click', closeSheet) });
}
function openMappeItem(y, id) {
  openSheet({
    title: 'Steuermappe', live: true,
    render: () => {
      const i = TD.mappe(y).find((x) => x.id === id); if (!i) return '<div class="card">Position nicht gefunden.</div>';
      const v = i.state.values || {}; const a = i.auto || {};
      const unassigned = (S().documents || []).filter((d) => +d.year === +y && d.status !== 'inbox' && !d.taxItem && d.kind !== 'erklaerung');
      return `<div class="lbl">${esc(i.area)}${i.ziffer ? ' · Ziffer ' + i.ziffer + ' ' + esc(TD.ZIFFERN[i.ziffer] || '') : ''}</div><div class="big2">${esc(i.label)}</div>
        <div class="note">${esc(i.how)}</div>
        ${i.auto ? `<div class="small mut">Automatisch: ${esc(i.auto.detail || '')}</div>` : ''}
        ${i.prev ? `<div class="small mut">Erklärung ${i.prev.year}: Staat ${fmtV(i.prev.staat)} · Bund ${fmtV(i.prev.bund)}</div>` : ''}
        ${i.ziffer ? `<div class="grid2 mt"><label class="field"><span>${i.wsv ? 'Steuerwert 31.12.' : 'Betrag Staat'}</span><input name="staat" inputmode="decimal" value="${esc(v.staat ?? '')}" placeholder="${esc(a.staat ?? '')}"></label>
          ${i.wsv ? `<label class="field"><span>Ertrag A (mit VSt)</span><input name="ertragA" inputmode="decimal" value="${esc(v.ertragA ?? '')}" placeholder="${esc(a.ertragA ?? '')}"></label><label class="field"><span>Ertrag B (ohne VSt)</span><input name="ertragB" inputmode="decimal" value="${esc(v.ertragB ?? '')}" placeholder="${esc(a.ertragB ?? '')}"></label>`
            : `<label class="field"><span>Betrag Bund</span><input name="bund" inputmode="decimal" value="${esc(v.bund ?? '')}" placeholder="${esc(a.bund ?? '')}"></label>`}</div>
          <div class="small mut">Leer lassen = automatischer Wert (grau). Eigener Wert überschreibt.</div>` : ''}
        ${i.coins ? `<div class="lbl mt">Crypto-Zeilen (Code KRY)</div>${i.coins.map((c) => `<div class="txr"><b class="grow">${esc(c.asset)}</b><span class="small">${qty(c.qty)}</span><span class="small mut">${c.rate != null ? '× ' + c.rate : 'Kurs fehlt'}</span><b class="small">${c.rate != null ? chf(c.qty * c.rate) : '–'}</b></div>`).join('')}` : ''}
        <div class="lbl mt">Belege (${i.docs.length})</div>
        ${i.docs.map((d) => `<div class="txr"><span class="grow small">${esc(d.title || d.fileName)}<div class="mut">${esc(d.fileName || '')}</div></span><button class="btn line sm" data-open-file="${esc(d.file)}">Öffnen</button>${d.isInvoice ? '<span class="tag">Rechnung</span>' : `<button class="btn danger sm" data-unlink="${d.id}">✕</button>`}</div>`).join('') || '<div class="small mut">Noch kein Beleg.</div>'}
        <label class="btn line block">⬆ Beleg hinzufügen<input type="file" multiple accept="application/pdf,image/*" data-up-item hidden></label>
        ${unassigned.length ? `<label class="field"><span>Vorhandenes Dokument zuordnen</span><select data-assign><option value="">–</option>${unassigned.map((d) => `<option value="${d.id}">${esc(d.title || d.fileName)}</option>`).join('')}</select></label>` : ''}
        <label class="field mt"><span>Notiz</span><input name="note" value="${esc(i.state.note || '')}"></label>
        <button class="btn gold block big mt" data-act="done">${i.status === 'eingetragen' ? '✓ In E-Tax eingetragen' : 'Speichern & als eingetragen markieren'}</button>
        <div class="grid2"><button class="btn line" data-act="save">Nur speichern</button><button class="btn line" data-act="nicht">${i.status === 'nicht' ? 'Wieder nötig' : 'Dieses Jahr nicht nötig'}</button></div>`;
    },
    bind: (el) => {
      const st = () => ((TD.mappe(y), S().taxYears[y].mappe)[id] ||= {});
      const read = () => { const o = {}; for (const k of ['staat', 'bund', 'ertragA', 'ertragB']) { const f = el.querySelector(`[name=${k}]`); if (f) o[k] = f.value.trim() === '' ? '' : Number(f.value.replace(/['’]/g, '').replace(',', '.')); } return o; };
      el.querySelector('[data-up-item]').addEventListener('change', async (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) { await uploadMappe(fs, y, id); } });
      el.querySelector('[data-assign]')?.addEventListener('change', (e) => { const d = S().documents.find((x) => x.id === e.target.value); if (d) { d.taxItem = id; commit(); } });
      el.addEventListener('click', async (e) => {
        const o = e.target.closest('[data-open-file]'); if (o) { const u = await getFileURL(o.dataset.openFile); if (u) window.open(u, '_blank', 'noopener'); return; }
        const ul = e.target.closest('[data-unlink]'); if (ul) { const d = S().documents.find((x) => x.id === ul.dataset.unlink); if (d) { d.taxItem = null; commit(); } return; }
        const b = e.target.closest('[data-act]'); if (!b) return; const s0 = st();
        const vals = read(); if (Object.values(vals).some((x) => Number.isNaN(x))) return toast('Betrag ungültig');
        s0.values = vals; s0.note = el.querySelector('[name=note]').value.trim();
        if (b.dataset.act === 'done') s0.status = 'eingetragen';
        if (b.dataset.act === 'nicht') s0.status = s0.status === 'nicht' ? '' : 'nicht';
        commit(); toast('Gespeichert'); if (b.dataset.act !== 'save') closeSheet();
      });
    },
  });
}
function bindMappe(el, y) {
  el.querySelector('[data-mappe=upload]')?.addEventListener('change', async (e) => { const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return; toast(`Lese ${fs.length} Beleg(e) …`); await uploadMappe(fs, y); });
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mi]'); if (m) return openMappeItem(y, m.dataset.mi);
    if (e.target.closest('[data-mappe=report]')) return openReport(y);
  });
}
function openReport(y) {
  openSheet({
    title: `Bericht ${y}`,
    render: () => `<div class="small mut">Der Bericht listet jede Ziffer mit Betrag (Staat/Bund), Beleg und Vorjahr – zum Abtippen in E-Tax BL. Das Steuerpaket (ZIP) enthält zusätzlich alle Belege in einer Ordnerstruktur.</div>
      <button class="btn gold block big mt" data-act="pack">📦 Steuerpaket ${y} (ZIP mit Bericht + Belegen)</button>
      <button class="btn line block" data-act="html">📄 Nur Bericht (HTML zum Drucken)</button>`,
    bind: (el) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'pack') { b.disabled = true; b.textContent = 'Erstelle Paket …'; try { const { blob, count } = await buildPackage(y); download(`Steuerpaket_${y}.zip`, blob); toast(`${count} Dateien im Steuerpaket`); } catch (err) { console.error(err); toast('Paket fehlgeschlagen'); } b.disabled = false; b.textContent = `📦 Steuerpaket ${y} (ZIP mit Bericht + Belegen)`; }
      if (b.dataset.act === 'html') download(`Steuern_${y}_Eintragen.html`, reportHTML(y), 'text/html');
    }),
  });
}

function openTaxSettings() {
  const c = TC.cfg();
  openSheet({
    title: 'Steuer-Einstellungen',
    render: () => `<label class="check"><input type="checkbox" name="sep" ${c.gemeindeSeparate ? 'checked' : ''}> Meine Gemeinde stellt die Gemeindesteuer separat in Rechnung</label>
      <label class="field"><span>Fälligkeit Gemeindesteuer (Tag.Monat)</span><input name="gdue" value="${esc(c.gemeindeDue.slice(3) + '.' + c.gemeindeDue.slice(0, 2))}" inputmode="numeric" placeholder="30.09"></label>
      <div class="small mut">Steht auf der Rechnung der Gemeinde. Viele Baselbieter Gemeinden lassen die Gemeindesteuer seit 2026 vom Kanton beziehen – dann ist sie mit der Staatssteuer am 30.9. fällig.</div>
      <div class="lbl mt">Zinssätze ${c.ratesYear} (steuern.bl.ch › Zinssätze)</div>
      <div class="grid2"><label class="field"><span>Vergütungszins Staat %</span><input name="vzs" inputmode="decimal" value="${c.vzStaat}"></label><label class="field"><span>Vergütungszins Bund %</span><input name="vzb" inputmode="decimal" value="${c.vzBund}"></label>
        <label class="field"><span>Verzugszins Staat %</span><input name="vgs" inputmode="decimal" value="${c.verzugStaat}"></label><label class="field"><span>Verzugszins Bund %</span><input name="vgb" inputmode="decimal" value="${c.verzugBund}"></label></div>
      <label class="field"><span>Gültig für Jahr</span><input name="ry" inputmode="numeric" value="${c.ratesYear}"></label>
      <button class="btn gold block big mt" data-act="save">Speichern</button>`,
    bind: (el) => el.querySelector('[data-act=save]').addEventListener('click', () => {
      const v = (n) => el.querySelector(`[name=${n}]`).value.trim(); const n = (x) => Number(String(x).replace(',', '.'));
      const m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(v('gdue')); if (!m || +m[2] > 12 || +m[1] > 31) return toast('Fälligkeit als Tag.Monat, z. B. 30.09');
      for (const k of ['vzs', 'vzb', 'vgs', 'vgb']) if (!(n(v(k)) >= 0 && n(v(k)) < 20)) return toast('Zinssatz ungültig');
      Object.assign(c, { gemeindeSeparate: el.querySelector('[name=sep]').checked, gemeindeDue: `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
        vzStaat: n(v('vzs')), vzBund: n(v('vzb')), verzugStaat: n(v('vgs')), verzugBund: n(v('vgb')), ratesYear: +v('ry') || c.ratesYear });
      commit(); toast('Gespeichert'); closeSheet();
    }),
  });
}
function openExtension(y) {
  const t = ty(y);
  openSheet({
    title: `Frist ${y}`,
    render: () => `<div class="note">Bis <b>31.05.${y + 1}</b> ist die Frist automatisch verlängert – ohne Gesuch, ohne Gebühr. Brauchst du länger, stell ein Gesuch online (E-Tax BL / steuern.bl.ch › Fristerstreckung). Längere Verlängerungen sind gebührenpflichtig (CHF 40, Stand 2024), sehr lange müssen begründet werden.</div>
      <label class="field mt"><span>Neue Frist laut Bestätigung</span><input name="d" type="date" value="${esc(t.extUntil || `${y + 1}-05-31`)}"></label>
      <button class="btn gold block big mt" data-act="save">Frist übernehmen</button>`,
    bind: (el) => el.querySelector('[data-act=save]').addEventListener('click', () => {
      const d = el.querySelector('[name=d]').value; if (!d) return toast('Datum fehlt');
      t.extUntil = d; commit(); toast('Frist gespeichert'); closeSheet();
    }),
  });
}
function bindTaxCalendar(el) {
  el.querySelector('[data-reserve]')?.addEventListener('change', (e) => { TC.cfg().reserveAccountId = e.target.value; commit(); });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal-act]'); if (!b) return;
    const a = b.dataset.calAct; const s = S();
    if (a === 'settings') return openTaxSettings();
    if (a === 'ext') return openExtension(+b.dataset.y);
    if (a === 'filed') { const t = ty(+b.dataset.y); t.filed = new Date().toISOString(); t.checklist.eingereicht = true; commit(); toast(`Erklärung ${b.dataset.y} als eingereicht markiert – PDF unter «Archiv» ablegen`); return; }
    if (a === 'pay') { const i = s.invoices.find((x) => x.id === b.dataset.inv); if (i && confirm(`${chf(+i.amount, 2)} als bezahlt markieren?`)) { i.status = 'paid'; i.paidAt = isoDay(new Date()); commit(); toast('Als bezahlt markiert'); } return; }
    if (a === 'addinv') return openInvoice(null, { category: 'Steuern', taxKind: b.dataset.kind, taxYear: +b.dataset.y, issuer: b.dataset.kind === 'Gemeinde' ? 'Gemeinde' : 'Steuerverwaltung Basel-Landschaft', title: `${TC.KIND_LABEL[b.dataset.kind] || 'Steuer'} ${b.dataset.y}`, due: TC.legalDue(b.dataset.kind, +b.dataset.y), taxStage: 'provisorisch' });
  });
}

export function taxes() {
  const y = ui.taxYear; const t = ty(y);
  const snap = t.closed ? t.snapshot : null;
  const hold = snap ? snap.holdings : Object.values(yearEndHoldings(y)).filter((x) => x.qty > 1e-8).map((x) => ({ asset: x.asset, qty: x.qty, quality: x.quality }));
  const rates = snap ? snap.rates : t.rates;
  let total = 0, missingRate = 0;
  for (const h of hold) { const r = rates[h.asset]; if (r && r.chf != null) total += h.qty * r.chf; else missingRate++; }
  const inv = S().invoices.filter((i) => i.tax !== 'no' && new Date(i.paidAt || i.due).getFullYear() === y);
  const byZ = {}; inv.forEach((i) => { (byZ[i.ziffer || '–'] ||= []).push(i); });
  return {
    title: `Steuern ${y}`, sub: `${esc(S().settings.canton)} · E-Tax BL <button class="ybtn" data-y="-1">‹</button><button class="ybtn" data-y="1">›</button>`,
    html: `
    ${taxCalendarHTML()}
    <div class="lbl mt">Steuermappe ${y}</div>
    ${mappeHTML(y)}
    ${taxExtrasHTML(y)}
    <div class="lbl mt">Crypto-Steuerbericht · Bestand per 31.12.${y}</div>
    <div class="card ${snap ? 'goldb' : ''}">
      <div class="row"><div class="grow"><div class="small mut">Steuerwert Crypto total</div><div class="serif big2">${chf(total)}</div></div>
        ${snap ? `<span class="tag gold">abgeschlossen ${dmyShort(t.closed)}</span>` : ''}</div>
      <div class="small gold2">Eintragen: Wertschriften- und Guthabenverzeichnis (Ziffer 800)</div>
      <div class="ttable"><div class="th"><span>Asset</span><span>Bestand</span><span>Kurs</span><span>Wert</span></div>
      ${hold.map((h) => { const r = rates[h.asset]; return `<div class="tr ${snap ? '' : 'clickable'}" data-rate="${esc(h.asset)}"><b>${esc(h.asset)}</b><span>${qty(h.qty)}</span><span>${r && r.chf != null ? nrp(r.chf) : '<i class="amber">fehlt</i>'}</span><b>${r && r.chf != null ? chf(h.qty * r.chf) : '–'}</b>
        <small class="${!r ? 'amber' : r.source === 'ESTV' ? 'pos' : 'amber'}">${r ? 'Kurs: ' + esc(r.source) : 'Steuerkurs eintragen'}</small></div>`; }).join('') || '<div class="small mut">Kein Crypto-Bestand per 31.12.</div>'}</div>
      ${!snap ? `<div class="small mut mt">Steuerkurse findest du in der ESTV-Kursliste (ICTax). Fehlt dort ein Coin, gilt der Jahresendkurs der Plattform als Ersatz. Für die Vermögenssteuer zählt nur der Bestand, nicht der Kaufpreis.</div>
        <div class="grid2 mt"><a class="btn line" href="https://www.ictax.admin.ch" target="_blank" rel="noopener">ESTV ICTax öffnen</a><button class="btn line" data-act="fallback">Ersatzkurse laden</button></div>
        <button class="btn gold block mt" data-act="close" ${missingRate ? 'disabled' : ''}>${missingRate ? `${missingRate} Steuerkurs${missingRate > 1 ? 'e' : ''} fehlen` : `Jahr ${y} abschliessen (Snapshot einfrieren)`}</button>`
        : '<button class="btn line block mt" data-act="reopen">Abschluss aufheben</button>'}
      <div class="grid2 mt"><button class="btn line" data-act="print">PDF / Drucken</button><button class="btn line" data-act="csv">CSV exportieren</button></div>
    </div>
    ${inv.length ? `<div class="lbl mt">Steuerrelevante Belege ${y}</div>${Object.entries(byZ).map(([z, list]) => `<div class="card"><div class="row"><b class="grow">Ziffer ${esc(z)}</b><b>${chf(list.reduce((a, i) => a + (+i.amount || 0), 0), 2)}</b></div>
      ${list.map((i) => `<div class="txr clickable" data-inv="${i.id}">${i.tax === 'yes' ? icon('ok') : icon('warn')}<span class="grow small">${esc(i.issuer)} · ${esc(i.title || '')}</span><span class="small">${chf(+i.amount, 2)}</span></div>`).join('')}</div>`).join('')}` : ''}`,
    bind: (el) => { bindTaxCalendar(el); bindMappe(el, y); bindTaxExtras(el, y, (yy) => { ui.taxYear = yy; dispatchEvent(new Event('rerender')); scrollTo(0, 0); }); el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-cal-act], [data-reserve], [data-mi], [data-mappe]')) return;
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
      if (b.dataset.act === 'reopen' && confirm('Abschluss aufheben?')) { t.closed = null; t.snapshot = null; commit(); }
      if (b.dataset.act === 'csv') {
        const lines = [['Asset', 'Bestand 31.12.' + y, 'Steuerkurs CHF', 'Steuerwert CHF', 'Kursquelle'].join(';')];
        hold.forEach((h) => { const r = rates[h.asset]; lines.push([h.asset, h.qty, r ? r.chf : '', r ? (h.qty * r.chf).toFixed(2) : '', r ? r.source : ''].join(';')); });
        lines.push(['Total', '', '', total.toFixed(2), ''].join(';'));
        download(`Crypto_Steuerbericht_${y}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv');
      }
      if (b.dataset.act === 'print') printReport(y, hold, rates, total, !!snap);
    }); },
  };
}

function openRate(y, sym) {
  const t = ty(y); const r = t.rates[sym] || {};
  openSheet({
    title: `Steuerkurs ${sym}`,
    render: () => `<div class="small mut">Kurs per 31.12.${y} in CHF. Quelle zuerst ESTV ICTax, sonst Jahresendkurs der Plattform.</div>
      <label class="field mt"><span>Kurs CHF</span><input name="v" inputmode="decimal" value="${esc(r.chf ?? '')}"></label>
      <div class="lbl">Quelle</div>${chips('src', [['ESTV', 'ESTV ICTax'], ['BingX 31.12.', 'BingX 31.12.'], ['Relai 31.12.', 'Relai 31.12.'], ['Einstandspreis', 'Einstandspreis']], r.source || 'ESTV')}
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
  const open = s.invoices.filter((i) => i.status === 'open' && match(i)).sort((a, b) => ((a.due || '9') < (b.due || '9') ? -1 : 1));
  const paid = s.invoices.filter((i) => i.status === 'paid' && match(i)).sort((a, b) => ((b.paidAt || '') < (a.paidAt || '') ? -1 : 1));
  const sum = open.reduce((a, i) => a + (+i.amount || 0), 0);
  const row = (i) => {
    const d = i.due ? daysUntil(i.due) : null;
    const st = i.status === 'paid' ? `<span class="pos">bezahlt ${dmy(i.paidAt)}</span>` : d == null ? '<span class="mut">ohne Fälligkeit</span>' : d < 0 ? `<span class="neg">überfällig seit ${-d} Tag${d === -1 ? '' : 'en'}</span>` : d === 0 ? '<span class="amber">heute fällig</span>' : `<span class="${d <= 7 ? 'amber' : 'mut'}">fällig in ${d} Tag${d === 1 ? '' : 'en'} · ${dmyShort(i.due)}</span>`;
    return `<div class="card row clickable" data-inv="${i.id}">${i.status === 'paid' ? icon('ok') : `<i class="dotc ${d != null && d < 0 ? 'red' : d != null && d <= 7 ? 'amber' : 'grey'}"></i>`}
      <div class="grow"><b>${esc(i.issuer)}</b>${i.title ? ` <span class="small mut">· ${esc(i.title)}</span>` : ''}<div class="small">${st}${i.file ? ' · 📎' : ''}</div></div><b class="${i.status === 'paid' ? 'mut' : ''}">${chf(+i.amount, 2)}</b></div>`;
  };
  return {
    title: 'Rechnungen', sub: `${open.length} offen · ${chf(sum, 2)}`,
    html: `<input class="search" data-search placeholder="Suchen: Aussteller, Nummer, Betrag …" value="${esc(ui.invSearch)}">
      <div class="grid2"><button class="btn gold" data-act="add">＋ Rechnung</button><button class="btn line" data-act="scan">📷 Scannen</button></div>
      <div class="lbl mt">Offen · ${chf(sum, 2)}</div>${open.map(row).join('') || '<div class="card mut small">Keine offenen Rechnungen</div>'}
      <div class="lbl mt">Bezahlt</div>${paid.map(row).join('') || '<div class="card mut small">Noch keine</div>'}
      <div class="small mut mt">Erinnerungen: Vault › Einstellungen › «Erinnerungen in Kalender übernehmen» oder in der Rechnung «In Kalender».</div>`,
    bind: (el) => {
      const sI = el.querySelector('[data-search]');
      sI.addEventListener('input', () => { ui.invSearch = sI.value; dispatchEvent(new Event('rerender')); const n = document.querySelector('[data-search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      el.addEventListener('click', (e) => {
        const i = e.target.closest('[data-inv]'); if (i) return openInvoice(S().invoices.find((x) => x.id === i.dataset.inv));
        if (e.target.closest('[data-act=add]')) openInvoice();
        if (e.target.closest('[data-act=scan]')) openScanner();
      });
    },
  };
}

export function openInvoice(inv = null, preset = null) {
  const d = inv ? { ...inv } : { issuer: '', title: '', number: '', amount: '', due: '', category: '', tax: 'no', ziffer: '', status: 'open', paidAt: '', note: '', taxKind: '', taxYear: null, taxStage: '', ...(preset || {}) };
  let newFile = null;
  const capture = (el) => {
    const v = (n) => el.querySelector(`[name=${n}]`)?.value ?? '';
    Object.assign(d, { issuer: v('issuer'), title: v('title'), number: v('number'), reference: v('reference').replace(/\s+/g, ''), amount: v('amount'), due: v('due'), category: v('category'), ziffer: v('ziffer'), note: v('note'), paidAt: v('paidAt') || d.paidAt, tax: chipVal(el, 'tax') || d.tax, taxKind: v('taxKind'), taxYear: v('taxYear') ? +v('taxYear') : null, taxStage: v('taxStage') });
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
      <label class="field"><span>Zahlungsreferenz (QR / RF)</span><input name="reference" value="${esc(fmtRef(d.reference || ''))}" autocomplete="off" spellcheck="false" placeholder="z. B. 21 00000 00003 …"></label>
      ${d.iban || d.reference ? `<div class="row small"><span class="grow mut">${d.iban ? 'IBAN ' + esc(d.iban) : ''}</span>${d.reference ? '<button class="btn line sm" data-act="copyref">Referenz kopieren</button>' : ''}${d.iban ? '<button class="btn line sm" data-act="copyiban">IBAN kopieren</button>' : ''}</div>` : ''}
      <datalist id="cats">${['Studium', 'Wohnen', 'Versicherung', 'Gesundheit', 'Mobilität', 'Kommunikation', 'Steuern', 'Abos', 'Sonstiges'].map((c) => `<option value="${c}">`).join('')}</datalist>
      <div class="lbl">Steuer</div>${chips('tax', [['no', 'nicht relevant'], ['maybe', 'möglicherweise'], ['yes', 'steuerrelevant']], d.tax)}
      <label class="field"><span>E-Tax-Ziffer (z. B. 650 Weiterbildung, 720 Krankheit)</span><input name="ziffer" value="${esc(d.ziffer)}" inputmode="numeric"></label>
      <div class="grid2"><label class="field"><span>Steuerart (nur Kategorie Steuern)</span><select name="taxKind"><option value="">–</option>${TAX_KINDS.map((k) => `<option ${k === d.taxKind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="field"><span>Für Steuerjahr</span><input name="taxYear" inputmode="numeric" value="${esc(d.taxYear || '')}" placeholder="z. B. ${new Date().getFullYear() - 1}"></label>
        <label class="field span2"><span>Rechnungsart (nur Steuern)</span><select name="taxStage"><option value="">–</option>${[['provisorisch', 'Provisorisch / Vorausrechnung'], ['definitiv', 'Definitiv (nach Veranlagung)'], ['nachzahlung', 'Nachzahlung / Zins']].map(([k, l]) => `<option value="${k}" ${k === d.taxStage ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
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
        if (b.dataset.act === 'copyref' || b.dataset.act === 'copyiban') { const val = b.dataset.act === 'copyref' ? d.reference : d.iban; try { await navigator.clipboard.writeText(String(val).replace(/\s+/g, '')); toast('Kopiert – im E-Banking einfügen'); } catch (e) { toast('Kopieren nicht möglich'); } return; }
        if (b.dataset.act === 'paid') { d.status = 'paid'; d.paidAt = isoDay(new Date()); rerender(); return; }
        if (b.dataset.act === 'unpaid') { d.status = 'open'; d.paidAt = ''; rerender(); return; }
        if (b.dataset.act === 'view') { const u = await getFileURL(inv.file); if (u) window.open(u, '_blank', 'noopener'); return; }
        if (b.dataset.act === 'ics') return downloadICS(d);
        if (b.dataset.act === 'del') {
          if (!confirm('Rechnung löschen?')) return;
          if (inv.file) await deleteFile(inv.file);
          s.invoices = s.invoices.filter((x) => x.id !== inv.id); commit(); closeSheet(); return;
        }
        const amount = Number(String(d.amount).replace(/['’]/g, '').replace(',', '.'));
        if (!d.issuer.trim() || !(amount >= 0) || d.amount === '') return toast('Aussteller und Betrag angeben');
        const o = { ...d, issuer: d.issuer.trim(), amount };
        if (o.category === 'Steuern') { o.taxKind = o.taxKind || 'Staat BL'; o.taxYear = o.taxYear || new Date().getFullYear() - 1; }
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
export function vault(sub) {
  if (sub === 'pruefen') return reviewPage();
  if (sub === 'inbox') return inboxPage();
  if (sub === 'dokumente') return documentsPage();
  if (sub === 'ledger') return ledgerPage();
  if (sub === 'einstellungen') return settingsPage();
  const s = S();
  const status = (name, maxDays) => {
    const im = s.imports[name]; if (!im) return '<span class="mut">noch nie importiert</span>';
    const d = Math.floor((Date.now() - new Date(im.last)) / 864e5);
    return `<span class="${d <= maxDays ? 'pos' : d <= maxDays * 2 ? 'amber' : 'neg'}">● Import ${ago(im.last)}${im.to ? ' · Daten bis ' + esc(im.to.slice(0, 10)) : ''}</span>`;
  };
  const others = Object.keys(s.imports).filter((k) => !['BingX', 'Relai'].includes(k));
  const rc = reviewCount();
  return {
    title: 'Vault', sub: 'Import-Zentrale · du lieferst Rohdaten, Finance Vault rechnet',
    html: `
    <button class="btn gold block big" data-act="scan">📷 Dokument scannen / hochladen</button>
    <div class="grid2"><button class="btn line" data-go="#/vault/inbox">📥 Inbox${s.documents.filter((d) => d.status === 'inbox').length ? ' (' + s.documents.filter((d) => d.status === 'inbox').length + ')' : ''}</button><button class="btn line" data-go="#/vault/dokumente">🗂 Dokumente</button></div>
    <div class="lbl mt">Import</div>
    ${rc ? `<div class="card row clickable goldb" data-go="#/vault/pruefen">${icon('warn')}<div class="grow"><b>${rc} Transaktion${rc > 1 ? 'en' : ''} zuordnen</b><div class="small mut">Lieber einmal fragen als falsch rechnen</div></div><span class="gold">›</span></div>` : ''}
    <div class="card"><div class="row"><div class="grow"><b class="big1">BingX</b><div class="small mut">Kontoauszüge: Spot_Account.csv + Fund_Account.csv (alle auf einmal wählen)</div></div>
      <label class="btn line sm">Importieren<input type="file" multiple accept=".csv,text/csv,text/plain" data-import="BingX" hidden></label></div>
      <div class="small mt">${status('BingX', 35)}</div>
      <div class="small mut">So geht's: BingX › Assets › Export › Konto-Auszug (max. 1 Jahr pro Export). Futures/Wealth-Dateien darfst du mitwählen.</div>
      ${s.raw.bingx && s.raw.bingx.length ? `<button class="btn line sm mt" data-act="bxre">↻ Neu berechnen (${s.raw.bingx.length} Zeilen)</button>` : ''}</div>
    <div class="card"><div class="row"><div class="grow"><b class="big1">Relai</b><div class="small mut">CSV-Export der Auftragshistorie</div></div>
      <label class="btn line sm">Importieren<input type="file" accept=".csv,text/csv,text/plain" data-import="Relai" hidden></label></div>
      <div class="small mt">${status('Relai', 35)}</div><div class="small mut">So geht's: Relai › Profil › Transaktionen › Export › CSV. Die Zuordnung wird angepasst, sobald ein Beispiel-Export vorliegt.</div></div>
    ${others.map((n) => `<div class="card row"><div class="grow"><b>${esc(n)}</b><div class="small">${status(n, 60)}</div></div><label class="btn line sm">Importieren<input type="file" accept=".csv,text/csv,text/plain" data-import="${esc(n)}" hidden></label></div>`).join('')}
    <div class="card row"><div class="grow"><b>Andere Plattform</b><div class="small mut">Beliebige CSV mit Spalten-Zuordnung</div></div><label class="btn line sm">CSV wählen<input type="file" accept=".csv,text/csv,text/plain" data-import="" hidden></label></div>
    <div class="card row clickable" data-go="#/vault/ledger"><div class="grow"><b>Ledger</b><div class="small ${s.ledger.last ? 'pos' : 'mut'}">${s.ledger.last ? '● Abgleich ' + ago(s.ledger.last.at) : s.ledger.addresses.length + ' Adressen · öffentliche Adressen, nur lesen'}</div></div><span class="gold">›</span></div>
    <div class="card row"><div class="grow"><b>VIAC, Bank</b><div class="small mut">Stand unter Invest › Konten aktualisieren</div></div><button class="btn line sm" data-go="#/invest">Konten</button></div>
    <div class="small mut">Nur CSV. Doppelte Transaktionen werden automatisch erkannt und ignoriert.</div>
    <button class="btn line block mt" data-go="#/vault/einstellungen">⚙️ Einstellungen, Backup, PIN</button>`,
    bind: (el) => {
      el.querySelectorAll('[data-import]').forEach((inp) => inp.addEventListener('change', async () => {
        const files = [...inp.files]; inp.value = ''; if (!files.length) return;
        try {
          const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
          const bx = texts.map((t) => BX.parseFile(t.text, t.name)).filter(Boolean);
          if (bx.length) openBingx(bx, texts.length - bx.length);
          else openImport(texts[0].text, inp.dataset.import, texts[0].name);
        } catch (e) { console.error(e); toast('Datei konnte nicht gelesen werden'); }
      }));
      el.querySelector('[data-act=bxre]')?.addEventListener('click', () => openBingx([], 0));
      el.querySelector('[data-act=scan]').addEventListener('click', openScanner);
    },
  };
}

// ---------- BingX-Import ----------
function openBingx(files, ignored) {
  const s = S();
  const incoming = files.flatMap((f) => f.rows);
  const merged = BX.mergeRaw(s.raw.bingx || [], incoming);
  let result = null; let busy = false;
  const existingIds = new Set(s.transactions.filter((t) => String(t.extId || '').startsWith('bingx:')).map((t) => t.extId));
  openSheet({
    title: 'BingX-Import',
    render: () => {
      const fl = files.map((f) => `<div class="txr"><span class="grow small"><b>${esc(f.name)}</b><br><span class="mut">${BX.ACCT_LABEL[f.acct]}-Konto</span></span><span class="small ${f.rows.length ? '' : 'mut'}">${f.rows.length ? f.rows.length + ' Zeilen' : 'leer, ignoriert'}</span></div>`).join('');
      let rep = '';
      if (result) {
        const st = result.stats; const newTx = result.txs.filter((t) => !existingIds.has(t.extId)).length;
        const miss = Object.entries(st.missingHistory).sort((a, b) => b[1] - a[1]);
        const bal = Object.entries(result.balances).filter(([, v]) => v > 1e-6);
        rep = `
        <div class="card goldb"><b class="gold">Auszug geprüft</b>
          <div class="small">Zeitraum ${esc((result.from || '').slice(0, 10))} bis ${esc((result.to || '').slice(0, 10))}</div>
          <div class="small">${st.swaps} Trades (davon ${st.recurring} Sparplan-Käufe) · ${st.withdrawals} Auszahlungen an ${esc(s.settings.defaultWallet)} · ${st.deposits} Einzahlungen · ${st.rewards} Rebates</div>
          ${Object.entries(st.recurringSpent).map(([a, v]) => `<div class="small">Sparplan: ${qty(v)} ${esc(a)} investiert</div>`).join('')}
          <div class="small mt"><b>${result.txs.length}</b> Transaktionen, davon <b>${newTx}</b> neu${result.missingChf ? ` · <span class="amber">${result.missingChf} ohne CHF-Kurs (offline?)</span>` : ''}</div></div>
        ${miss.length ? `<div class="card"><div class="row">${icon('warn')}<b class="grow">Kaufhistorie fehlt</b></div>
          <div class="small mut">Diese Coins tauchen im Auszug auf, ihre Käufe stehen aber nicht drin${st.gapFrom ? ` (Lücken zwischen ${esc(String(st.gapFrom).slice(0, 10))} und ${esc(String(st.gapTo).slice(0, 10))})` : ''}. Gleichzeitig verschwinden Stablecoins ohne Verkauf – typisch für Käufe über «Convert»/Schnellkauf oder ältere Spot-Trades, die BingX im Kontoauszug nicht aufführt. Bestand stimmt trotzdem. Den Kaufpreis kannst du nach dem Übernehmen unter Invest schätzen lassen.</div>
          ${miss.map(([a, v]) => `<div class="txr"><b class="grow">${esc(a)}</b><span class="small">${qty(v)}</span></div>`).join('')}</div>` : ''}
        ${Object.keys(st.stableGaps).length ? `<div class="card small">${icon('warn')} Fehlende Stablecoin-Buchungen (Käufe ausserhalb des Exports): ${Object.entries(st.stableGaps).map(([a, v]) => `${qty(v)} ${esc(a)}`).join(', ')}. Wurde als Ausgleich verbucht.</div>` : ''}
        ${st.review ? `<div class="card small">${icon('warn')} ${st.review} Einträge zum Zuordnen (z. B. Einzahlungen von Coins). Du wirst danach gefragt.</div>` : ''}
        ${bal.length ? `<div class="card"><div class="lbl">Noch auf BingX laut Auszug</div>${bal.map(([a, v]) => `<div class="txr"><b class="grow">${esc(a)}</b><span class="small">${qty(v)}</span></div>`).join('')}</div>` : ''}
        <button class="btn gold block big" data-act="apply">Übernehmen</button>`;
      }
      return `${files.length ? `<div class="card">${fl}</div>` : ''}${ignored ? `<div class="small amber">${ignored} Datei(en) nicht als BingX-Auszug erkannt und ignoriert.</div>` : ''}
        <div class="small mut">${merged.rows.length} Zeilen gesamt${files.length ? `, davon ${merged.added} neu` : ''}. Interne Umbuchungen (Spot ↔ Fund) werden ignoriert. Der Saldo jeder Zeile wird geprüft.</div>
        ${result ? rep : `<button class="btn gold block big mt" data-act="run" ${busy ? 'disabled' : ''}>${busy ? 'Berechne …' : 'Prüfen und berechnen'}</button>`}
        <div class="small mut mt" data-prog></div>`;
    },
    bind: (el) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'run') {
        busy = true; b.disabled = true; b.textContent = 'Lade Kurse und berechne …';
        const prog = el.querySelector('[data-prog]');
        try { result = await BX.build(merged.rows, (i, n) => { prog.textContent = `${i} / ${n}`; }); }
        catch (err) { console.error(err); toast('Fehler bei der Berechnung'); }
        busy = false; rerender();
      }
      if (b.dataset.act === 'apply') {
        s.raw.bingx = merged.rows;
        BX.apply(result);
        s.imports.BingX = { last: new Date().toISOString(), count: result.txs.length, to: result.to, toMs: result.toMs };
        commit(); closeAll(); toast('BingX übernommen'); dispatchEvent(new Event('refreshprices'));
        autoResolve().then((n) => { if (n) { commit(); toast(`${n} Einzahlung${n > 1 ? 'en' : ''} automatisch als eigener Transfer erkannt`, 4000); } });
        if (Object.keys(result.stats.missingHistory).length) setTimeout(() => { location.hash = '#/invest'; }, 300);
      }
    }),
  });
}

// ---------- Allgemeiner CSV-Import ----------
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
    trackQuote: saved ? saved.trackQuote : true, sample: [], checked: null,
  };
  const capture = (el) => {
    for (const [r] of ROLES) { const v = el.querySelector(`[name=m_${r}]`)?.value; if (v !== undefined) st.mapping[r] = v === '' ? undefined : +v; }
    st.platform = el.querySelector('[name=platform]')?.value.trim() || st.platform;
    st.defaultQuote = el.querySelector('[name=dq]')?.value.trim().toUpperCase() || 'CHF';
    st.defaultAsset = el.querySelector('[name=da]')?.value.trim().toUpperCase() || '';
    st.trackQuote = !!el.querySelector('[name=tq]')?.checked;
  };
  const opts = () => ({ platform: st.platform, defaultQuote: st.defaultQuote, defaultAsset: st.defaultAsset, trackQuote: st.trackQuote });
  const KL = { buy: 'Kauf', sell: 'Verkauf', deposit: 'Einzahlung', withdraw: 'Auszahlung', transfer: 'Transfer', reward: 'Reward', fee: 'Gebühr', review: 'Unklar' };
  const sampleHTML = () => (st.sample.length ? st.sample.map((r) => `<div class="txr"><div class="grow small"><b>${KL[r.kind]}</b> ${qty(r.amount)} ${esc(r.asset)}
    <div class="mut">${dmyShort(r.date)} · ${r.chf != null ? 'CHF ' + r.chf : r.total != null ? r.quote + ' ' + qty(r.total) : 'ohne Betrag'}</div></div></div>`).join('')
    : '<div class="small amber">Keine Zeile erkannt. Bitte Datum, Coin (oder Paar) und Menge zuordnen.</div>');
  const refreshSample = async (el) => {
    st.sample = (await interpret({ ...parsed, rows: parsed.rows.slice(0, 6) }, st.mapping, opts())).records;
    const box = el.querySelector('[data-sample]'); if (box) box.innerHTML = sampleHTML();
  };
  openSheet({
    title: 'Import ' + st.platform, capture,
    render: () => `
      <div class="small mut">${esc(fname)} · ${parsed.rows.length} Zeilen · ${parsed.headers.length} Spalten${saved ? ' · gespeicherte Zuordnung' : ''}</div>
      <label class="field mt"><span>Plattform</span><input name="platform" value="${esc(st.platform)}"></label>
      <div class="lbl">Spalten zuordnen</div>
      <div class="grid2">${ROLES.map(([r, l]) => `<label class="field"><span>${l}</span><select name="m_${r}"><option value="">–</option>${parsed.headers.map((h, i) => `<option value="${i}" ${st.mapping[r] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>
      <div class="grid2">
        <label class="field"><span>Gegenwährung falls keine Spalte</span><input name="dq" value="${esc(st.defaultQuote)}"></label>
        <label class="field"><span>Coin falls keine Spalte</span><input name="da" value="${esc(st.defaultAsset)}" placeholder="z. B. BTC bei Relai"></label>
      </div>
      <label class="check"><input type="checkbox" name="tq" ${st.trackQuote ? 'checked' : ''}> Gegen-Coins (z. B. USDT) als eigenen Bestand mitführen</label>
      <div class="lbl mt">Vorschau</div><div class="card" data-sample>${sampleHTML()}</div>
      ${/bingx/i.test(st.platform) && s.raw.bingx && s.raw.bingx.length ? `<div class="note amber"><b>Achtung Doppelzählung:</b> Du hast bereits BingX-Kontoauszüge importiert. Handelshistorie zusätzlich über den allgemeinen Import einzulesen, zählt dieselben Trades doppelt. Für BingX bitte nur Spot_Account.csv/Fund_Account.csv verwenden.</div>` : ''}
      ${st.checked ? `<div class="card goldb"><b class="gold">Import geprüft</b><div class="small">${st.checked.read} gelesen · ${st.checked.dup} schon vorhanden${st.checked.skipped ? ' · ' + st.checked.skipped + ' früher gelöscht' : ''} · <b>${st.checked.fresh.length} neu</b>${st.checked.errors ? ' · ' + st.checked.errors + ' unlesbar' : ''}</div>
        ${st.checked.review ? `<div class="small amber">${st.checked.review} davon unklar</div>` : ''}</div>
        <button class="btn gold block big" data-act="go" ${st.checked.fresh.length ? '' : 'disabled'}>${st.checked.fresh.length} Transaktionen importieren</button>`
        : '<button class="btn gold block big mt" data-act="check">Prüfen</button>'}
      <div class="small mut mt" data-prog></div>`,
    bind: (el) => {
      el.querySelectorAll('select, input').forEach((i) => i.addEventListener('change', () => { capture(el); st.checked = null; refreshSample(el); }));
      if (!st.sample.length) refreshSample(el);
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        capture(el);
        if (b.dataset.act === 'check') { const r = await interpret(parsed, st.mapping, opts()); st.checked = { read: r.records.length, errors: r.errors, ...preview(r.records) }; rerender(); return; }
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
// Ein-Tipp-Entscheide für die häufigsten Fälle; «Details» öffnet das volle Formular.
const dirOf = (t) => t.dir || (/Fehlende Abbuchung|\s-\d/.test(t.raw || '') ? 'out' : 'in');
function reviewPage() {
  const h = hiddenAssets();
  const list = S().transactions.filter((t) => t.type === 'review' && !h.has(t.asset)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const btns = (t) => (dirOf(t) === 'in'
    ? `<button class="btn line sm" data-q="transfer">Eigener Transfer</button><button class="btn line sm" data-q="buyday">Kauf (Tageskurs ≈)</button><button class="btn line sm" data-q="opening">Anfangsbestand</button>`
    : `<button class="btn line sm" data-q="transfer">Eigener Transfer</button><button class="btn line sm" data-q="sellday">Verkauf (Tageskurs ≈)</button><button class="btn line sm" data-q="fee">Gebühr</button>`)
    + '<button class="btn line sm" data-q="ignore">Nicht relevant</button><button class="btn sm" data-q="details">Details …</button>';
  return {
    title: 'Bitte zuordnen', sub: `${list.length} offen · lieber einmal fragen als falsch rechnen`,
    html: (list.length ? `<div class="small mut">Eigener Transfer = Coins zwischen deinen eigenen Konten (Bestand bleibt). Tageskurs ≈ = mit dem CHF-Kurs dieses Tages, als geschätzt markiert. Nicht relevant = zählt nirgends (Demo, Scam, Staub).</div>` : '')
      + (list.map((t) => `<div class="card clickable" data-tx="${t.id}"><div class="row">${icon('warn')}<b class="grow">${dirOf(t) === 'in' ? '+' : '−'}${qty(t.amount)} ${esc(t.asset)}</b><span class="small mut">${esc(t.platform)} · ${dmy(t.date)}</span></div>
      <div class="small mt">${esc(t.raw || '')}</div><div class="small mut">${esc(t.note || '')}</div>
      <div class="qbtns">${btns(t)}</div></div>`).join('') || '<div class="card">Alles zugeordnet 👍</div>'),
    bind: (el) => el.addEventListener('click', async (e) => {
      const q = e.target.closest('[data-q]');
      if (!q) { const c = e.target.closest('[data-tx]'); if (c) openTx(S().transactions.find((x) => x.id === c.dataset.tx)); return; }
      const t = S().transactions.find((x) => x.id === q.closest('[data-tx]').dataset.tx); if (!t) return;
      const a = q.dataset.q;
      if (a === 'details') return openTx(t);
      const set = (o) => { Object.assign(t, o, { decided: true }); delete t.raw; delete t.suggest; };
      if (a === 'transfer') set({ type: 'transfer', chf: 0, to: t.dir === 'out' ? (S().settings.defaultWallet || '') : (t.platform || '') });
      if (a === 'opening') set({ type: 'opening', chf: null });
      if (a === 'fee') set({ type: 'fee', chf: 0 });
      if (a === 'ignore') set({ type: 'ignore', chf: null });
      if (a === 'buyday' || a === 'sellday') {
        if (!navigator.onLine) return toast('Offline – Kurs nicht abrufbar');
        q.disabled = true; q.textContent = 'Lade Kurs …';
        const r = await historicalCHF(t.asset, t.date).catch(() => null);
        if (r == null) { toast(`Kein historischer Kurs für ${t.asset} gefunden – bitte unter Details eintragen`, 4000); q.disabled = false; q.textContent = a === 'buyday' ? 'Kauf (Tageskurs ≈)' : 'Verkauf (Tageskurs ≈)'; return; }
        set({ type: a === 'buyday' ? 'buy' : 'sell', chf: +(r * t.amount).toFixed(2), estimate: 'day', note: 'Betrag geschätzt (Tageskurs)' + (t.note ? ' · ' + t.note : '') });
      }
      commit(); toast('Zugeordnet');
    }),
  };
}

// ---------- Server ----------
function serverCard() {
  const c = S().server || {};
  if (!c.token) return `<div class="card small mut">Verbinde deinen Server für Push-Mitteilungen und automatische BingX-Trades. Adresse und Kopplungscode findest du auf dem Server (siehe Anleitung).</div>
    <label class="field"><span>Server-Adresse</span><input name="srvurl" placeholder="https://server.tailxxxx.ts.net" autocapitalize="off" autocomplete="off" value="${esc(c.url || '')}"></label>
    <label class="field"><span>Kopplungscode</span><input name="srvcode" autocapitalize="characters" autocomplete="off" placeholder="z. B. DW3QUJQW"></label>
    <button class="btn gold block" data-act="srvpair">Server verbinden</button>`;
  return `<div class="card"><div class="row">${c.status && !c.status.ok ? icon('warn') : icon('ok')}<div class="grow"><b>${esc(c.url.replace('https://', ''))}</b>
      <div class="small ${c.status && !c.status.ok ? 'amber' : 'mut'}">${c.status ? esc(c.status.msg) : 'gekoppelt'} · Abgleich ${c.lastSync ? ago(c.lastSync) : 'noch nie'}</div>
      <div class="small mut">Mitteilungen: ${c.push ? 'aktiv' : 'aus'} · BingX: ${c.bingx ? (c.bingxLast ? 'Server-Sync ' + ago(new Date(c.bingxLast)) : 'konfiguriert') : 'kein API-Schlüssel'}${c.version ? ' · Server v' + esc(c.version) : ''}</div>
      ${(() => { const w = SRV.buildWatch(); return `<div class="small mut">Beobachtet: ${Object.keys(w.coins).length} Coins, ${w.tickers.length} Wertschriften, ${w.addresses.length} Adressen – keine Mengen, keine Beträge.</div>`; })()}</div></div></div>
    <label class="check"><input type="checkbox" data-set="ledgerViaServer" ${S().settings.ledgerViaServer !== false ? 'checked' : ''}> Ledger-Adressen über den Server prüfen (automatisch, mit Push bei Änderungen)</label>
    <div class="grid2"><button class="btn ${c.push ? 'line' : 'gold'}" data-act="srvpush">${c.push ? 'Push erneuern' : '🔔 Mitteilungen aktivieren'}</button><button class="btn line" data-act="srvtest">Test-Mitteilung</button></div>
    <div class="grid2"><button class="btn line" data-act="srvsync">↻ Jetzt abgleichen</button><button class="btn line" data-act="srvbx">BingX neu abfragen</button></div>
    <button class="btn danger block" data-act="srvoff">Server trennen</button>`;
}
async function serverAction(a, el, b) {
  const busy = (t) => { if (b) { b.disabled = true; b.textContent = t; } };
  try {
    if (a === 'srvpair') {
      busy('Verbinde …');
      const h = await SRV.pair(el.querySelector('[name=srvurl]').value, el.querySelector('[name=srvcode]').value.trim().toUpperCase());
      toast('Server verbunden' + (h.bingx ? ' · BingX aktiv' : ''));
      await SRV.syncAll({ quiet: true });
    }
    if (a === 'srvpush') { busy('Aktiviere …'); await SRV.enablePush(); await SRV.syncReminders(true); toast('Mitteilungen aktiv'); }
    if (a === 'srvtest') { busy('Sende …'); const r = await SRV.testPush(); toast(r.ok ? 'Test gesendet – kommt gleich' : 'Kein Gerät registriert – zuerst Mitteilungen aktivieren'); }
    if (a === 'srvsync') { busy('Gleiche ab …'); const r = await SRV.syncAll({ quiet: false, force: true }); toast(r ? `Abgeglichen${r.trades ? ` · ${r.trades} Trades` : ''}${r.funding ? ` · ${r.funding} Ein-/Auszahlungen` : ''}${r.auto ? ` · ${r.auto} automatisch zugeordnet` : ''}` : 'Abgeglichen'); }
    if (a === 'srvbx') { busy('Frage BingX ab …'); const r = await SRV.triggerBingx(); await SRV.syncAll({ quiet: false }); toast(r.ok ? `BingX: ${r.new} neue Trades${r.newFunding ? `, ${r.newFunding} Ein-/Auszahlungen` : ''}` : 'BingX: ' + (r.error || 'Fehler')); }
    if (a === 'srvoff' && confirm('Verbindung zum Server trennen? Der Zugang wird auch auf dem Server gelöscht.')) { busy('Trenne …'); await SRV.unpair(); toast('Getrennt'); }
  } catch (e) { toast(e.message, 4000); }
  commit();
}

// ---------- Einstellungen ----------
function settingsPage() {
  const s = S().settings;
  return {
    title: 'Einstellungen', sub: 'Backup, PIN, Kurse',
    html: `
    <label class="field"><span>Dein Name</span><input data-set="name" value="${esc(s.name)}" maxlength="40"></label>
    <label class="field"><span>Standard-Wallet für Auszahlungen</span><input data-set="defaultWallet" value="${esc(s.defaultWallet)}" maxlength="40"></label>
    <label class="field"><span>Automatisch sperren nach (Minuten, 1–60)</span><input data-set="autoLockMin" type="number" min="1" max="60" inputmode="numeric" value="${s.autoLockMin}"></label>
    <label class="field"><span>CoinGecko Demo-API-Key (optional, für mehr Abfragen)</span><input data-set="cgKey" value="${esc(s.cgKey)}" placeholder="CG-…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <div class="lbl mt">Backup</div>
    <div class="card small mut">Das Backup wird doppelt verschlüsselt: mit deinem PIN <b>und</b> einem separaten Backup-Passwort (mind. 10 Zeichen). So bleibt es sicher, auch wenn die Datei in iCloud oder per Mail in falsche Hände gerät. Ohne Backup sind die Daten bei Verlust des iPhones weg.</div>
    <div class="grid2"><button class="btn gold" data-act="backup">⬇ Backup exportieren</button><label class="btn line">⬆ Backup laden<input type="file" data-act="restore" accept=".json,application/json" hidden></label></div>
    <div class="lbl mt">Eigener Server (Tailscale)</div>
    ${serverCard()}
    <div class="lbl mt">Erinnerungen ohne Server</div>
    <div class="card small mut">Übernimmt Jahresabschluss (31.12.), Monats-Update, Steuerdokumente (Januar) und alle offenen Rechnungen mit Alarm in den iPhone-Kalender. Funktioniert auch, wenn die App geschlossen ist. Nach neuen Rechnungen erneut tippen.</div>
    <button class="btn line block" data-act="ics">📅 Erinnerungen in Kalender übernehmen</button>
    <div class="lbl mt">Sicherheit</div>
    <div class="grid2"><button class="btn line" data-act="pin">PIN ändern</button><button class="btn line" data-act="lock">Jetzt sperren</button></div>
    <div class="lbl mt">Ausgeblendete Coins</div>
    <div class="card small">${(s.ignoredAssets || []).length ? s.ignoredAssets.map((a) => `<div class="txr"><b class="grow">${esc(a)}</b><button class="btn line sm" data-unhide="${esc(a)}">Einblenden</button></div>`).join('') : '<span class="mut">Keine. Ausblenden im Coin-Detail (Invest › Coin).</span>'}
      <div class="mut mt">Zählen nirgends mit: Demo-Guthaben (z. B. VST von BingX), Scam-Airdrops, Staub.</div></div>
    <div class="lbl mt">Daten</div>
    <div class="grid2"><button class="btn line" data-act="demo">Demo-Daten laden</button><button class="btn line" data-act="goals">Standard-Ziele</button></div>
    <button class="btn danger block mt" data-act="wipe">Alles löschen</button>
    <div class="small mut center mt">Finance Vault v${APP_VERSION} · ${S().transactions.length} Transaktionen · ${S().invoices.length} Rechnungen</div>`,
    bind: (el) => {
      el.querySelectorAll('[data-set]').forEach((i) => i.addEventListener('change', () => {
        s[i.dataset.set] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Math.min(60, Math.max(1, Math.round(Number(i.value) || 5))) : i.value.trim();
        if (i.type === 'number') i.value = s[i.dataset.set];
        commit(); toast('Gespeichert');
        if (i.dataset.set === 'ledgerViaServer') dispatchEvent(new Event('serversync'));
      }));
      el.querySelector('[data-act=restore]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        try { const text = await f.text(); openRestore(text, backupInfo(text)); } catch (err) { toast(err.message || 'Ungültiges Backup'); }
      });
      el.addEventListener('click', async (e) => {
        const u = e.target.closest('[data-unhide]');
        if (u) { s.ignoredAssets = (s.ignoredAssets || []).filter((x) => x !== u.dataset.unhide); commit(); toast(`${u.dataset.unhide} wieder eingeblendet`); return; }
        const b = e.target.closest('button[data-act]'); if (!b) return;
        const a = b.dataset.act;
        if (a === 'backup') openBackup();
        if (a.startsWith('srv')) return serverAction(a, el, b);
        if (a === 'ics') download('FinanceVault_Erinnerungen.ics', remindersICS(), 'text/calendar');
        if (a === 'lock') { await flush(); lock(); location.reload(); }
        if (a === 'pin') openChangePin();
        if (a === 'demo' && confirm('Demo-Daten laden? Deine aktuellen Daten werden ersetzt. Vorher ein Backup machen!')) { setState(demoState()); commit(); location.hash = '#/'; toast('Demo-Daten geladen'); dispatchEvent(new Event('refreshprices')); }
        if (a === 'goals' && confirm('Standard-Ziele hinzufügen?')) { S().goals.push(...defaultGoals(S())); commit(); toast('Ziele hinzugefügt'); }
        if (a === 'wipe' && confirm('Wirklich ALLES löschen?') && prompt('Zur Bestätigung LÖSCHEN eintippen') === 'LÖSCHEN') { await wipeAll(); location.reload(); }
      });
    },
  };
}

// Passwortfelder statt prompt(): prompt() zeigt die Eingabe im Klartext an.
const pw = (name, label, auto = 'off') => `<label class="field"><span>${label}</span><input name="${name}" type="password" autocomplete="${auto}" autocapitalize="off" spellcheck="false"></label>`;
const pinStrength = (p) => (/^\d+$/.test(p) ? 'Nur Ziffern: bequem, aber schwach. Mit Buchstaben/Wort-Passphrase ist der Vault deutlich sicherer.' : p.length < 10 ? 'Gut. Länger (10+ Zeichen) ist noch sicherer.' : 'Stark.');

function openChangePin() {
  openSheet({
    title: 'PIN ändern',
    render: () => `${pw('old', 'Aktueller PIN', 'current-password')}${pw('n1', 'Neuer PIN / Passwort (mind. 6 Zeichen)', 'new-password')}${pw('n2', 'Neuen PIN wiederholen', 'new-password')}
      <div class="small mut" data-str></div>
      <div class="small mut mt">Alle Daten und Dateien werden mit dem neuen PIN neu verschlüsselt (alles oder nichts – bei einem Abbruch bleibt der alte PIN gültig).</div>
      <button class="btn gold block big mt" data-act="go">PIN ändern</button>`,
    bind: (el) => {
      const val = (n) => el.querySelector(`[name=${n}]`).value;
      el.querySelector('[name=n1]').addEventListener('input', () => { el.querySelector('[data-str]').textContent = val('n1') ? pinStrength(val('n1')) : ''; });
      el.querySelector('[data-act=go]').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        if (val('n1').length < 6) return toast('Mindestens 6 Zeichen');
        if (val('n1') !== val('n2')) return toast('Neue PINs stimmen nicht überein');
        b.disabled = true; b.textContent = 'Verschlüssele neu …';
        try {
          await flush();
          const ok = await changePin(val('old'), val('n1'), S());
          toast(ok ? 'PIN geändert' : 'Aktueller PIN falsch');
          if (ok) closeSheet();
        } catch (err) { console.error(err); toast('Fehler – alter PIN bleibt gültig'); }
        b.disabled = false; b.textContent = 'PIN ändern';
      });
    },
  });
}

function openBackup() {
  openSheet({
    title: 'Backup exportieren',
    render: () => `<div class="small mut">Wähle ein Backup-Passwort (mind. 10 Zeichen, z. B. vier zufällige Wörter). Notiere es getrennt vom iPhone – ohne Backup-Passwort <b>und</b> PIN lässt sich das Backup nicht öffnen.</div>
      ${pw('p1', 'Backup-Passwort', 'new-password')}${pw('p2', 'Backup-Passwort wiederholen', 'new-password')}
      <button class="btn gold block big mt" data-act="go">⬇ Backup erstellen</button>`,
    bind: (el) => el.querySelector('[data-act=go]').addEventListener('click', async (e) => {
      const b = e.currentTarget; const p1 = el.querySelector('[name=p1]').value;
      if (p1.length < 10) return toast('Mindestens 10 Zeichen');
      if (p1 !== el.querySelector('[name=p2]').value) return toast('Passwörter stimmen nicht überein');
      b.disabled = true; b.textContent = 'Verschlüssele …';
      try { await flush(); download(`FinanceVault_Backup_${isoDay(new Date())}.json`, await exportBackup(p1)); (S().meta ||= {}).lastBackup = new Date().toISOString(); commit(true); toast('Backup erstellt – tipp es in «Analyse › Health» einmal an, um es zu testen', 4500); closeSheet(); }
      catch (err) { console.error(err); toast(err.message || 'Backup fehlgeschlagen'); b.disabled = false; b.textContent = '⬇ Backup erstellen'; }
    }),
  });
}

function openRestore(text, info) {
  openSheet({
    title: 'Backup laden',
    render: () => `<div class="note amber"><b>Ersetzt alle aktuellen Daten</b> durch das Backup${info.exported ? ' vom ' + dmy(info.exported) : ''}. Erst wenn Passwort und PIN stimmen, wird etwas verändert.</div>
      ${info.needsPassword ? pw('bp', 'Backup-Passwort', 'current-password') : '<div class="small amber">Älteres Backup ohne Backup-Passwort (nur PIN-geschützt). Nach dem Laden bitte ein neues Backup erstellen.</div>'}
      ${pw('pin', 'PIN des Backups', 'current-password')}
      <button class="btn gold block big mt" data-act="go">Prüfen und ersetzen</button>`,
    bind: (el) => el.querySelector('[data-act=go]').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!confirm('Alle aktuellen Daten durch das Backup ersetzen?')) return;
      b.disabled = true; b.textContent = 'Prüfe …';
      try {
        await importBackup(text, { password: el.querySelector('[name=bp]')?.value || '', pin: el.querySelector('[name=pin]').value });
        toast('Backup geladen – bitte entsperren'); setTimeout(() => location.reload(), 600);
      } catch (err) { toast(err.message || 'Ungültiges Backup', 4000); b.disabled = false; b.textContent = 'Prüfen und ersetzen'; }
    }),
  });
}
