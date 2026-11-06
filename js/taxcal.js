// =====================================================================
// taxcal.js – Steuerkalender Basel-Landschaft: Fristen, Zahlungen, Rücklage
//
// Regeln (Stand 2026, jährlich prüfen – steuern.bl.ch):
//  · Steuererklärung Vorjahr: Frist 31.3., stillschweigend verlängert bis 31.5.
//    Längere Fristerstreckung per Online-Gesuch (gebührenpflichtig, CHF 40).
//  · Direkte Bundessteuer Vorjahr: fällig 1.3., zahlbar bis 31.3. (provisorische
//    Rechnung im Januar). Verzugszins ab Fälligkeit.
//  · Staatssteuer laufendes Jahr: provisorische Rechnung Anfang Jahr, fällig 30.9.
//    Vorauszahlungen werden mit Vergütungszins belohnt.
//  · Gemeindesteuer: vielerorts seit 2026 mit der Staatssteuer (30.9.), sonst
//    eigener Termin der Gemeinde (einstellbar).
//  · Definitive Rechnungen (nach der Veranlagung): eigenes Zahlungsziel.
// Beträge kommen aus deinen Rechnungen (Kategorie «Steuern»). Fehlt die Rechnung
// noch, wird der Vorjahresbetrag als Schätzung (≈) verwendet.
// =====================================================================
import { S } from './store.js';
import { mappe } from './taxdocs.js';

const DAY = 864e5;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const end = (d) => new Date(d + 'T23:59:59').getTime();
export const KIND_LABEL = { 'Staat BL': 'Staatssteuer', Gemeinde: 'Gemeindesteuer', Bund: 'Direkte Bundessteuer', Andere: 'Andere Steuer' };

export const cfg = () => (S().taxSettings ||= { gemeindeSeparate: false, gemeindeDue: '09-30', vzStaat: 0.1, vzBund: 0, verzugStaat: 5, verzugBund: 4, ratesYear: 2026, reserveAccountId: '' });

// Gesetzliche Fälligkeit je Steuerart und Steuerjahr
export function legalDue(kind, year) {
  const c = cfg();
  if (kind === 'Bund') return iso(year + 1, 3, 31);
  if (kind === 'Gemeinde' && c.gemeindeSeparate) { const [m, d] = String(c.gemeindeDue || '09-30').split('-').map(Number); return iso(year, m || 9, d || 30); }
  return iso(year, 9, 30);
}

function invoicesFor(kind, year) {
  return S().invoices.filter((i) => i.category === 'Steuern' && (i.taxKind || 'Staat BL') === kind && +i.taxYear === +year);
}
function sums(list) {
  let soll = 0, paid = 0;
  for (const i of list) { const a = +i.amount || 0; soll += a; if (i.status === 'paid') paid += a; }
  return { soll, paid, open: Math.max(0, soll - paid) };
}

// Zahlungs-Position für Steuerart + Jahr (mit Schätzung aus dem Vorjahr)
function payItem(kind, year, now) {
  const list = invoicesFor(kind, year); const sm = sums(list);
  let estimate = null;
  if (!list.length) {
    for (let y = year - 1; y >= year - 3; y--) { const p = sums(invoicesFor(kind, y)); if (p.soll > 0) { estimate = p.soll; break; } }
  }
  const openInv = list.filter((i) => i.status !== 'paid' && i.due).sort((a, b) => (a.due < b.due ? -1 : 1));
  const due = openInv.length ? openInv[0].due : legalDue(kind, year);
  const open = list.length ? sm.open : estimate || 0;
  const days = Math.ceil((end(due) - now) / DAY);
  const done = list.length > 0 && sm.open < 0.5;
  return {
    id: `pay-${kind}-${year}`, type: 'pay', kind, year, title: `${KIND_LABEL[kind] || kind} ${year}`, due, days,
    soll: sm.soll, paid: sm.paid, open, estimate, invoices: list, done,
    status: done ? 'done' : days < 0 ? 'over' : days <= 21 ? 'soon' : 'open',
    stage: list.some((i) => i.taxStage === 'definitiv') ? 'definitiv' : list.length ? 'provisorisch' : 'fehlt',
  };
}

function filingItem(year, now) {
  const s = S(); const t = s.taxYears[year] || {};
  const doc = (s.documents || []).find((d) => d.kind === 'erklaerung' && +d.year === year);
  const filed = t.filed || (doc && (doc.created || true));
  const due = iso(year + 1, 3, 31), ext = t.extUntil || iso(year + 1, 5, 31);
  const last = filed ? due : (now > end(due) ? ext : due);
  const days = Math.ceil((end(last) - now) / DAY);
  return {
    id: `file-${year}`, type: 'file', year, title: `Steuererklärung ${year} einreichen`, due: last, ordinary: due, ext, days, filed: !!filed,
    filedAt: typeof filed === 'string' ? filed : null, done: !!filed,
    status: filed ? 'done' : days < 0 ? 'over' : days <= 21 ? 'soon' : 'open',
  };
}

// Alle relevanten Positionen rund um «jetzt», nach Datum sortiert
export function calendar(now = Date.now()) {
  const Y = new Date(now).getFullYear(); const c = cfg(); const items = [];
  // Erklärung des Vorjahres (die frühere ist entweder erledigt oder nicht mehr in der App erfasst)
  items.push(filingItem(Y - 1, now));
  const kinds = ['Bund', 'Staat BL', ...(c.gemeindeSeparate ? ['Gemeinde'] : [])];
  for (const k of kinds) {
    for (const y of [Y - 2, Y - 1, Y, Y + 1]) {
      const it = payItem(k, y, now);
      const legal = end(legalDue(k, y));
      // Zeigen: alles mit offenen Rechnungen; sonst nur das «nächste» Steuerjahr dieser Art
      const upcoming = legal >= now && legal - now < 400 * DAY && !items.some((x) => x.type === 'pay' && x.kind === k && !x.invoices.length);
      if ((it.invoices.length && (!it.done || now - end(it.due) < 60 * DAY)) || (!it.invoices.length && upcoming)) items.push(it);
    }
  }
  // Übrige Steuerrechnungen (z. B. «Andere», Nachzahlungen) aus offenen Rechnungen
  for (const i of S().invoices.filter((x) => x.category === 'Steuern' && x.status !== 'paid' && !kinds.includes(x.taxKind || 'Staat BL'))) {
    const it = payItem(i.taxKind || 'Andere', +i.taxYear || Y, now); if (!items.some((x) => x.id === it.id)) items.push(it);
  }
  return items.sort((a, b) => (a.done - b.done) || (a.due < b.due ? -1 : 1));
}

// Rücklage: wie viel pro Monat zur Seite legen, damit alle offenen Steuern rechtzeitig bezahlt sind
export function reservePlan(now = Date.now()) {
  const s = S(); const c = cfg();
  const open = calendar(now).filter((x) => x.type === 'pay' && !x.done && x.open > 0 && x.days >= 0);
  let monthly = 0; const rows = [];
  for (const x of open) {
    const months = Math.max(1, Math.ceil(x.days / 30.4));
    rows.push({ ...x, months, perMonth: x.open / months }); monthly += x.open / months;
  }
  const total = open.reduce((a, x) => a + x.open, 0);
  const acc = s.accounts.find((a) => a.id === c.reserveAccountId);
  const have = acc ? Number(acc.value) || 0 : null;
  // Plan mit vorhandener Rücklage: nur der fehlende Teil muss noch angespart werden
  const missing = have != null ? Math.max(0, total - have) : total;
  const share = total > 0 ? missing / total : 0;
  return { rows, total, monthly: monthly * share, monthlyGross: monthly, account: acc, have, missing, coverage: total > 0 && have != null ? Math.min(1, have / total) : null };
}

// Vergütungszins bei Zahlung heute statt am Fälligkeitstag (Zinstage /360)
export function earlyInterest(item) {
  const c = cfg(); const rate = item.kind === 'Bund' ? +c.vzBund : +c.vzStaat;
  if (!(rate > 0) || !(item.open > 0) || item.days <= 0) return 0;
  return item.open * (rate / 100) * (item.days / 360);
}
export function lateInterest(item) {
  const c = cfg(); const rate = item.kind === 'Bund' ? +c.verzugBund : +c.verzugStaat;
  if (!(item.open > 0) || item.days >= 0) return 0;
  return item.open * (rate / 100) * (-item.days / 360);
}

// Erinnerungen (Push + Kalender): 14 und 3 Tage vorher sowie am Tag selbst
export function reminderDates(now = Date.now()) {
  const out = [];
  for (const x of calendar(now)) {
    if (x.done) continue;
    const base = end(x.due) - DAY + 9 * 36e5; // 09:00 am Fälligkeitstag
    const what = x.type === 'file' ? x.title : `${x.title} bezahlen`;
    for (const [k, off, txt] of [['14', 14, 'in 14 Tagen'], ['3', 3, 'in 3 Tagen'], ['0', 0, 'heute']]) {
      const at = base - off * DAY; if (at > now - DAY) out.push({ id: `tax-${x.id}-${k}`, at, title: x.type === 'file' ? 'Steuererklärung' : 'Steuern bezahlen', body: `${what}: Frist ${txt}.`, day: new Date(at).toISOString().slice(0, 10) });
    }
    if (x.type === 'file' && !x.filed && x.due === x.ordinary) {
      const at = end(x.ext) - DAY + 9 * 36e5 - 7 * DAY;
      if (at > now) out.push({ id: `tax-${x.id}-ext`, at, title: 'Steuererklärung', body: `Verlängerte Frist (${x.ext.slice(8, 10)}.${x.ext.slice(5, 7)}.) endet in 7 Tagen – sonst Fristerstreckung beantragen.`, day: new Date(at).toISOString().slice(0, 10) });
    }
  }
  // Fehlende Belege fürs Vorjahr: Mitte Februar und Anfang März nachfragen (nur Namen, keine Beträge)
  const Y = new Date(now).getFullYear(); const f = calendar(now).find((x) => x.type === 'file');
  if (f && !f.done) {
    const miss = mappe(Y - 1).filter((i) => i.status === 'fehlt' && i.when !== '–');
    for (const [id, m, d] of [['feb', 1, 15], ['mar', 2, 5]]) {
      const at = new Date(Y, m, d, 18).getTime();
      if (miss.length && at > now) out.push({ id: `tax-docs-${Y}-${id}`, at, title: 'Steuerbelege', body: `Noch nicht in der Steuermappe: ${miss.slice(0, 3).map((i) => i.label).join(', ')}${miss.length > 3 ? ' …' : ''}`, day: new Date(at).toISOString().slice(0, 10) });
    }
  }
  return out;
}

// Belege fürs Steuerjahr: welche Checklisten-Punkte sind schon belegt?
export const CHECK_EVIDENCE = { lohn: ['100'], '3a': ['610'], bildung: ['650'], krank: ['720'], spenden: ['738'], bank: ['800'], weg: ['500'] };
export function evidence(year) {
  const s = S(); const out = {};
  const docs = (s.documents || []).filter((d) => d.status !== 'inbox' && +d.year === +year);
  const inv = s.invoices.filter((i) => i.tax !== 'no' && new Date(i.paidAt || i.due).getFullYear() === +year);
  for (const [k, zz] of Object.entries(CHECK_EVIDENCE)) {
    const n = docs.filter((d) => zz.includes(String(d.ziffer))).length + inv.filter((i) => zz.includes(String(i.ziffer))).length;
    if (n) out[k] = n;
  }
  if ((s.taxYears[year] || {}).closed) out.crypto = 1;
  return out;
}
