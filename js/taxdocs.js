// =====================================================================
// taxdocs.js – Steuermappe: sammelt übers Jahr alle Belege, liest Beträge
// aus und erzeugt «Was trage ich wo ein» für E-Tax BL.
//
//  · POSITIONEN    werden dynamisch erzeugt: feste Vorlage (aus deinen Erklärungen
//                  2022/2023), je Bank-/Depotkonto ein Steuerauszug, Crypto, Belege
//                  aus Rechnungen, plus Ziffern, die du im Vorjahr ausgefüllt hast.
//  · AUSLESEN      Lohnausweis (Nettolohn Ziff. 11), 3a-Bescheinigung (Total),
//                  E-Steuerauszug (Steuerwert, Bruttoertrag A/B), E-Tax-Ausdruck
//                  des Vorjahres (Werte je Ziffer, Staat/Bund getrennt).
//  · Alles bleibt verschlüsselt im Vault. Organisationshilfe, keine Steuerberatung.
// =====================================================================
import { S, uid } from './store.js';
import { putFile } from './vault.js';
import { yearEndHoldings, accountAt, hiddenAssets } from './calc.js';
import * as LIB from './libs.js';

// ---------- Ziffern E-Tax BL (Auszug, wie in deinen Erklärungen 2022/2023) ----------
export const ZIFFERN = {
  100: 'Haupterwerb (Nettolohn laut Lohnausweis)', 110: 'Nebenerwerb', 300: 'Erträge aus Guthaben und Wertschriften',
  500: 'Fahrtkosten Wohn-/Arbeitsort', 510: 'Auswärtige Verpflegung', 520: 'Übrige Berufskosten', 530: 'Auslagen Nebenerwerb',
  600: 'Einkäufe 2. Säule', 610: 'Beiträge Säule 3a', 625: 'Versicherungsprämien und Sparzinsen', 650: 'Aus- und Weiterbildung',
  655: 'Vermögensverwaltungskosten', 670: 'Übrige Abzüge', 720: 'Krankheits- und Unfallkosten', 738: 'Freiwillige Zuwendungen',
  800: 'Wertschriften und Guthaben', 805: 'Bargeld, Edelmetalle', 891: 'Übrige Schulden', 970: 'Bruttoertrag A (mit Verrechnungssteuer)',
  971: 'Bruttoertrag B (ohne Verrechnungssteuer)', 972: 'Verrechnungssteuer-Anspruch (35 % von A)',
};

const num = (s) => { const n = Number(String(s || '').replace(/['’\s]/g, '').replace(/,(\d{2})$/, '.$1')); return Number.isFinite(n) ? n : null; };
const NUM = "([\\d'’]+(?:[.,]\\d{1,2})?)(?![.\\d])"; // keine Datumsteile (31.12.)

// ---------- PDF -> Zeilen (mit x-Positionen) ----------
export async function pdfLines(bytes) {
  const pdfjs = await LIB.pdfjs();
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false }).promise;
  const pages = []; const raw = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    raw.push(tc.items.map((i) => i.str).join(' '));
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let r = rows.find((q) => Math.abs(q.y - y) < 2.5);
      if (!r) { r = { y, items: [] }; rows.push(r); }
      r.items.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim(); }
    pages.push(rows);
  }
  pages.raw = raw.join('\n').replace(/\s+/g, ' ');
  return pages;
}
// Zeilen (nach Position) + Rohtext (in PDF-Reihenfolge) – manche Auszüge sind nur so lesbar
export const linesText = (pages) => pages.map((rows) => rows.map((r) => r.text).join('\n')).join('\n') + (pages.raw ? '\n@@RAW@@\n' + pages.raw : '');

// ---------- Dokumenttyp erkennen + Werte auslesen ----------
export function detect(text, name = '') {
  const t = text || ''; const n = name || '';
  if (/Jahresendbeilage|Erl(ae|ä)uterungen|Kontoauszug/i.test(n)) return { type: 'info' };
  if (/E-?Tax BL/i.test(t) && /eingereicht am|Steuererklärung\s+für natürliche Personen/i.test(t)) return { type: 'erklaerung' };
  if (/Lohnausweis|Certificat de salaire/i.test(t) && /Nettolohn/i.test(t)) return { type: 'lohn' };
  if (/Bescheinigung über Vorsorgebeiträge|Säule 3\s?a|pilier 3a/i.test(t) && /Total Beiträge an die Säule 3a|gebundenen Selbstvorsorge/i.test(t)) return { type: '3a' };
  if (/Steuerauszug|relevé fiscal/i.test(t) && /Steuerwert/i.test(t) && !/^\s*Erläuterungen zum Steuerauszug/i.test(t)) return { type: 'auszug' };
  if (/Zinsausweis|Zins- und Kapitalbescheinigung|Zinszahlung/i.test(t)) return { type: 'zins' };
  if (/Zugangscode|Zugangsdaten|Zugangs-?Code/i.test(t) && /Steuer/i.test(t)) return { type: 'zugang' };
  if (/Erläuterungen zum Steuerauszug|Jahresendbeilage|Kontoauszug/i.test(t)) return { type: 'info' };
  if (/U-?Abo|TNW|Generalabonnement|Halbtax/i.test(t)) return { type: 'abo' };
  return { type: null };
}
const BANKS = [[/Basellandschaftliche Kantonalbank|BLKB/i, 'BLKB'], [/VIAC|Terzo Vorsorgestiftung|WIR Bank/i, 'VIAC'], [/Raiffeisen/i, 'Raiffeisen'],
  [/Saxo/i, 'Saxo'], [/PostFinance/i, 'PostFinance'], [/UBS/i, 'UBS'], [/Neon|Hypothekarbank Lenzburg/i, 'Neon'], [/Yuh|Swissquote/i, 'Swissquote/Yuh'], [/frankly|ZKB|Zürcher Kantonalbank/i, 'ZKB/frankly']];
export const bankOf = (t) => (BANKS.find(([re]) => re.test(t || '')) || [, ''])[1];

export function extract(type, text) {
  const t = (text || '').replace(/[ \t]+/g, ' ');
  const m = (re) => { const x = re.exec(t); return x ? num(x[1]) : null; };
  if (type === 'lohn') {
    return { nettolohn: m(new RegExp(`11\\.?\\s*Nettolohn[^=\\n]*=\\s*${NUM}`, 'i')), bruttolohn: m(new RegExp(`8\\.?\\s*Bruttolohn[^=\\n]*=\\s*${NUM}`, 'i')),
      ahv: m(new RegExp(`9\\.?\\s*Beiträge AHV[^\\n]*?-\\s*${NUM}\\s*$`, 'im')) };
  }
  if (type === '3a') return { total: m(new RegExp(`Total Beiträge an die Säule 3a[^\\n]*?${NUM}\\s*$`, 'im')) };
  if (type === 'auszug') {
    // Zusammenfassung des E-Steuerauszugs (Rohtext in PDF-Reihenfolge ist am zuverlässigsten)
    const r = (t.split('@@RAW@@')[1] || t).replace(/\s+/g, ' ');
    const g = (re) => { const x = re.exec(r); return x ? num(x[x.length - 1]) : null; };
    let steuerwert = g(/Steuerwert (?:der )?A\s*-?\s*und B\s*-?\s*Werte am 31\.12\.\d{4}\s*([\d'’]+(?:\.\d{1,2})?)/i);
    if (steuerwert == null) { const a = /Steuerwert A-Werte:\s*CHF\s*([\d'’.]+)\s*;\s*Steuerwert B-Werte:\s*CHF\s*([\d'’.]+)/i.exec(r); if (a) steuerwert = num(a[1]) + num(a[2]); }
    const ertragA = g(/Bruttoertrag(?: 20\d\d)?\s*Werte mit (?:VSt\.?-?\s*Abzug|Verrechnungssteuer)\s*A?\s*([\d'’]+(?:\.\d{1,2})?)/i);
    const ertragB = g(/Bruttoertrag(?: 20\d\d)?\s*Werte ohne (?:VSt\.?-?\s*Abzug|Verrechnungssteuer)\s*B?\s*([\d'’]+(?:\.\d{1,2})?)/i);
    const vst = g(/Verrechnungs-?\s*steueranspruch\s*([\d'’]+(?:\.\d{1,2})?)/i);
    const vv = g(/Abzug Verm(?:ö|o)gens-?\s*verwaltungskosten\*?\s*([\d'’]+(?:\.\d{1,2})?)(?![.\d])/i) ?? g(/Total Verm(?:ö|o)gensverwaltungskosten\s*([\d'’]+(?:\.\d{1,2})?)(?![.\d])/i);
    const per = /am 31\.12\.(20\d\d)/.exec(r) || /31\.?\s*Dezember\s*(20\d\d)/i.exec(r);
    return { steuerwert, ertragA, ertragB, vst: vst ?? (ertragA != null ? +(ertragA * 0.35).toFixed(2) : null), vv, bank: bankOf(t), period: per ? +per[1] : null };
  }
  if (type === 'zins') return { zins: m(new RegExp(`(?:Habenzins|Bruttozins|Zinsertrag)\\s*CHF\\s*${NUM}`, 'i')), bank: bankOf(t) };
  return {};
}

// E-Tax-Ausdruck: Werte je Ziffer, Staat/Bund getrennt (Ziffern stehen als einzelne Kästchen)
export function parseDeclaration(pages) {
  const out = {}; let year = null;
  for (const rows of pages) {
    for (const r of rows) {
      if (!year) { const y = /Steuererklärung\s*(?:für natürliche Personen\s*)?(20\d\d)|E-Tax BL\s*(20\d\d)/i.exec(r.text); if (y) year = +(y[1] || y[2]); }
      const it = r.items;
      // Zeile beginnt mit einer Ziffer (3-stellig) und enthält dieselbe Ziffer nochmals vor den Werten
      const codeIdx = it.map((x, i) => (/^\d{3}$/.test(x.s.trim()) ? i : -1)).filter((i) => i >= 0);
      if (codeIdx.length < 2) continue;
      const code = it[codeIdx[0]].s.trim(); const last = codeIdx.filter((i) => it[i].s.trim() === code).pop();
      if (last === codeIdx[0] || !ZIFFERN[code] && !/^(399|499|789|790|885|899|910)$/.test(code)) continue;
      const digits = it.slice(last + 1).filter((x) => /^[\d–-]$/.test(x.s.trim()) || /^\d+$/.test(x.s.trim()));
      if (!digits.length) continue;
      // Kästchen zu Zahlen gruppieren: grosser Abstand = neue Spalte (Staat | Bund)
      const pitch = digits.length > 1 ? Math.min(...digits.slice(1).map((d, i) => d.x - digits[i].x).filter((v) => v > 0.5)) : 10;
      const groups = [[digits[0]]];
      for (let i = 1; i < digits.length; i++) { if (digits[i].x - digits[i - 1].x > pitch * 1.9) groups.push([]); groups[groups.length - 1].push(digits[i]); }
      const vals = groups.map((g) => Number(g.map((d) => d.s.trim()).join('').replace(/[–-]/g, ''))).filter((v) => Number.isFinite(v));
      if (vals.length) out[code] = { staat: vals[0], bund: vals[1] ?? vals[0] };
    }
  }
  return { year, values: out };
}

// ---------- Positionen der Mappe ----------
const SOURCES = { lohn: 'Arbeitgeber', '3a': 'Vorsorgestiftung', zugang: 'Steuerverwaltung BL', abo: 'TNW / SBB' };
export function mappe(year) {
  const s = S(); const t = (s.taxYears[year] ||= { rates: {}, checklist: {} });
  const st = (t.mappe ||= {});
  // Vorjahreswerte: jüngste eingelesene Erklärung vor diesem Jahr
  const prevYear = Object.keys(s.taxYears).map(Number).filter((y) => y < year && s.taxYears[y].declared).sort((a, b) => b - a)[0];
  const prev = prevYear ? s.taxYears[prevYear].declared.values || {} : {};
  const docs = (s.documents || []).filter((d) => d.status !== 'inbox' && +d.year === +year);
  const docsFor = (id) => docs.filter((d) => d.taxItem === id);
  const inv = (z) => s.invoices.filter((i) => String(i.ziffer) === z && i.tax !== 'no' && new Date(i.paidAt || i.due).getFullYear() === +year);
  const sumInv = (z) => inv(z).reduce((a, i) => a + (+i.amount || 0), 0);
  const items = [];
  const add = (o) => { const state = st[o.id] || {}; const d = docsFor(o.id); items.push({ ...o, docs: d, state, prev: o.ziffer && prev[o.ziffer] ? { ...prev[o.ziffer], year: prevYear } : null }); };

  add({ id: 'zugang', area: 'Start', label: 'E-Tax Zugangsdaten (Brief)', source: SOURCES.zugang, when: 'Februar', ziffer: null,
    how: 'Kommt per Post. Brief einscannen – der Zugangscode bleibt verschlüsselt im Vault. Damit E-Tax BL starten.' });
  // Lohnausweise
  const lohnDocs = docs.filter((d) => d.taxItem && d.taxItem.startsWith('lohn'));
  const lohnIds = [...new Set(['lohn', ...lohnDocs.map((d) => d.taxItem)])];
  let netto = 0;
  for (const id of lohnIds) {
    const d = docsFor(id); const e = d.map((x) => x.extract || {}).find((x) => x.nettolohn) || {};
    if (e.nettolohn) netto += e.nettolohn;
    add({ id, area: 'Einkommen', label: 'Lohnausweis' + (d[0] && d[0].issuer ? ' ' + d[0].issuer : ''), source: SOURCES.lohn, when: 'Januar/Februar', ziffer: '100',
      auto: e.nettolohn != null ? { staat: e.nettolohn, bund: e.nettolohn, detail: `Nettolohn (Ziff. 11)${e.bruttolohn ? ` · Brutto ${e.bruttolohn}` : ''}` } : null,
      how: 'Ziffer 11 «Nettolohn» des Lohnausweises in Ziffer 100 (Haupterwerb). Feld F (Gratis-Transport) und G (Kantine) beeinflussen Ziff. 500/510.' });
  }
  // Berufsauslagen
  const abo = sumInv('500');
  add({ id: 'abo', area: 'Berufsauslagen', label: 'ÖV-Abo Arbeitsweg', source: SOURCES.abo, when: 'laufend', ziffer: '500',
    auto: abo ? { staat: abo, bund: abo, detail: `${inv('500').length} Beleg(e) mit Ziffer 500` } : null, how: 'Abo-Kosten für den Arbeitsweg (Fragebogen Berufsauslagen › Abonnementskosten).' });
  add({ id: 'verpfl', area: 'Berufsauslagen', label: 'Auswärtige Verpflegung', source: 'Pauschale', when: '–', ziffer: '510',
    how: 'Pauschale für Mittagessen auswärts (mit Verbilligung durch Arbeitgeber tiefer). Wert aus dem Vorjahr prüfen.' });
  const bundP = netto ? Math.min(4000, Math.max(2000, Math.round(netto * 0.03))) : null;
  add({ id: 'berufskosten', area: 'Berufsauslagen', label: 'Übrige Berufskosten (Pauschale)', source: 'automatisch', when: '–', ziffer: '520',
    auto: { staat: 500, bund: bundP, detail: bundP ? 'Staat CHF 500 · Bund 3 % des Nettolohns (min. 2’000, max. 4’000)' : 'Staat CHF 500 · Bund nach Lohnausweis' },
    how: 'Pauschalabzug: Staat CHF 500, Bund 3 % des Nettolohns (mind. 2’000, höchstens 4’000).' });
  // Vorsorge 3a
  const ids3a = [...new Set(['3a', ...docs.filter((d) => d.taxItem && d.taxItem.startsWith('3a')).map((d) => d.taxItem)])];
  for (const id of ids3a) {
    const d = docsFor(id); const tot = d.map((x) => (x.extract || {}).total).find((v) => v != null);
    add({ id, area: 'Vorsorge', label: 'Säule 3a Bescheinigung' + (d[0] && d[0].bank ? ' ' + d[0].bank : ''), source: SOURCES['3a'], when: 'Januar', ziffer: '610',
      auto: tot != null ? { staat: tot, bund: tot, detail: 'Total Beiträge Säule 3a' } : null, how: 'Betrag «Total Beiträge an die Säule 3a» in Ziffer 610. Bescheinigung beilegen.' });
  }
  const saeule = items.some((i) => i.id.startsWith('3a') && i.auto && i.auto.staat > 0) || (prev['610'] && prev['610'].staat > 0);
  add({ id: 'versicherung', area: 'Abzüge', label: 'Versicherungsprämien (Pauschale)', source: 'automatisch', when: '–', ziffer: '625',
    auto: { staat: 2000, bund: saeule ? 1800 : 2700, detail: `Pauschale alleinstehend: Staat 2’000 / Bund ${saeule ? '1’800 (mit Beiträgen 2./3. Säule)' : '2’700 (ohne Beiträge 2./3. Säule)'} – Stand Formular 2023` },
    how: 'Pauschalabzug für Krankenkasse/Versicherungen und Sparzinsen. Bund: tiefer, wenn du in die 2. oder 3. Säule einzahlst. Beträge jährlich in der Wegleitung prüfen.' });
  for (const [z, label] of [['650', 'Aus- und Weiterbildung'], ['720', 'Krankheits- und Unfallkosten'], ['738', 'Spenden']]) {
    const v = sumInv(z); if (!v && !prev[z]) continue;
    add({ id: 'z' + z, area: 'Abzüge', label, source: 'Rechnungen / Belege', when: 'laufend', ziffer: z, auto: v ? { staat: v, bund: v, detail: `${inv(z).length} Beleg(e)` } : null,
      how: z === '720' ? 'Nur abziehbar, soweit die Kosten 5 % des Reineinkommens übersteigen.' : z === '650' ? 'Selbst bezahlte Kosten für berufsorientierte Aus- und Weiterbildung.' : 'Belege an gemeinnützige Organisationen.' });
  }
  // Vermögen: je Bank-/Depotkonto ein Steuerauszug (3a-Guthaben sind steuerfrei, nicht deklarieren)
  const accs = s.accounts.filter((a) => ['bank', 'securities'].includes(a.kind));
  const auszugIds = new Set(accs.map((a) => 'auszug-' + a.id));
  docs.filter((d) => d.taxItem && d.taxItem.startsWith('auszug-')).forEach((d) => auszugIds.add(d.taxItem));
  for (const id of auszugIds) {
    const a = s.accounts.find((x) => 'auszug-' + x.id === id); const d = docsFor(id);
    const e = d.map((x) => x.extract || {}).find((x) => x.steuerwert != null);
    const v31 = a ? accountAt(a, new Date(year, 11, 31, 23, 59).getTime()) : null;
    add({ id, area: 'Vermögen', label: 'Steuerauszug ' + (a ? a.name : (d[0] && (d[0].bank || d[0].issuer)) || 'Bank'), source: a ? a.name : 'Bank', when: 'Januar/Februar', ziffer: '800', wsv: true,
      auto: e ? { staat: e.steuerwert, bund: e.steuerwert, ertragA: e.ertragA || 0, ertragB: e.ertragB || 0, vst: e.vst || 0, detail: `Steuerwert · Ertrag A ${e.ertragA ?? 0} / B ${e.ertragB ?? 0}` }
        : v31 != null ? { staat: v31, bund: v31, ertragA: 0, ertragB: 0, estimate: true, detail: 'App-Stand per 31.12. (Steuerauszug fehlt)' } : null,
      how: 'E-Steuerauszug: in E-Tax BL im Wertschriftenverzeichnis «E-Steuerauszug importieren» (Barcode/PDF) – sonst Werte aus der «Zusammenfassung» übertragen.' });
  }
  // Crypto
  const snap = t.closed ? t.snapshot : null; const hidden = hiddenAssets();
  const hold = snap ? snap.holdings : Object.values(yearEndHoldings(year)).filter((x) => x.qty > 1e-8 && !hidden.has(x.asset));
  if (hold.length) {
    const rates = snap ? snap.rates : t.rates || {}; let tot = 0, miss = 0;
    for (const h of hold) { const r = rates[h.asset]; if (r && r.chf != null) tot += h.qty * r.chf; else miss++; }
    add({ id: 'krypto', area: 'Vermögen', label: 'Kryptowährungen per 31.12.', source: 'Finance Vault', when: 'Jahresabschluss', ziffer: '800', wsv: true,
      auto: { staat: Math.round(tot), bund: Math.round(tot), ertragA: 0, ertragB: 0, estimate: miss > 0, detail: `${hold.length} Coins${miss ? ` · ${miss} Steuerkurs(e) fehlen` : ''}${snap ? ' · abgeschlossen' : ''}` },
      coins: hold.map((h) => ({ asset: h.asset, qty: h.qty, rate: (rates[h.asset] || {}).chf ?? null })),
      how: 'Im Wertschriftenverzeichnis je Coin eine Zeile mit Code «KRY», Stückzahl und Steuerwert (Kurs ESTV ICTax).' });
  }
  if (prev['655'] || st.vv) add({ id: 'vv', area: 'Abzüge', label: 'Vermögensverwaltungskosten', source: 'Bank / Depot', when: 'Januar', ziffer: '655', how: 'Depot- und Verwaltungsgebühren laut Steuerauszug (z. B. VIAC). Nicht: Transaktionskosten.' });
  // Weitere Ziffern, die du im Vorjahr ausgefüllt hast
  const covered = new Set(items.map((i) => i.ziffer).filter(Boolean).concat(['399', '499', '789', '790', '885', '899', '910', '970', '971', '972', '300']));
  for (const z of Object.keys(prev)) if (!covered.has(z) && ZIFFERN[z] && (prev[z].staat > 0 || prev[z].bund > 0)) add({ id: 'z' + z, area: 'Weitere', label: ZIFFERN[z], source: 'wie Vorjahr', when: '–', ziffer: z, how: 'Im Vorjahr ausgefüllt – prüfen, ob es dieses Jahr wieder zutrifft.' });
  // Status je Position
  for (const it of items) {
    const v = it.state.values;
    it.value = v && (v.staat !== '' || v.bund !== '') ? { ...it.auto, ...v, manual: true } : it.auto || null;
    it.status = it.state.status === 'nicht' ? 'nicht' : it.state.status === 'eingetragen' ? 'eingetragen' : it.docs.length || (it.value && !it.value.estimate && it.source === 'automatisch') || it.state.status === 'da' ? 'da' : 'fehlt';
  }
  return items;
}

// Summen für Seite 1 / Wertschriftenverzeichnis
export function totals(items) {
  const w = items.filter((i) => i.wsv && i.status !== 'nicht' && i.value);
  const sw = w.reduce((a, i) => a + (+i.value.staat || 0), 0);
  const A = w.reduce((a, i) => a + (+i.value.ertragA || 0), 0), B = w.reduce((a, i) => a + (+i.value.ertragB || 0), 0);
  return { 800: Math.round(sw), 300: Math.round(A + B), 970: Math.round(A), 971: Math.round(B), 972: +(A * 0.35).toFixed(2), estimate: w.some((i) => i.value.estimate) };
}
export const progressOf = (items) => { const rel = items.filter((i) => i.status !== 'nicht'); return rel.length ? rel.filter((i) => i.status !== 'fehlt').length / rel.length : 0; };

// Neues Dokument einer Position zuordnen (nach Typ + Bank)
export function suggestItem(year, type, ex, text) {
  const s = S();
  const yd = (s.documents || []).filter((d) => +d.year === +year && d.taxItem);
  if (type === 'lohn') {
    const ls = yd.filter((d) => d.taxItem.startsWith('lohn'));
    const same = ls.find((d) => (d.extract || {}).nettolohn === ex.nettolohn);
    return same ? same.taxItem : ls.length ? 'lohn-' + (new Set(ls.map((d) => d.taxItem)).size + 1) : 'lohn';
  }
  if (type === '3a') {
    const ls = yd.filter((d) => d.taxItem.startsWith('3a')); const bank = ex.bank || bankOf(text);
    const same = ls.find((d) => (d.bank || '') === bank);
    return same ? same.taxItem : ls.length ? '3a-' + (bank || ls.length + 1).toString().toLowerCase().replace(/[^a-z0-9]/g, '') : '3a';
  }
  if (type === 'zugang') return 'zugang';
  if (type === 'abo') return 'abo';
  if (type === 'auszug' || type === 'zins') {
    const bank = ex.bank || bankOf(text);
    const acc = s.accounts.find((a) => ['bank', 'securities'].includes(a.kind) && bank && new RegExp(bank.split('/')[0], 'i').test(a.name));
    return acc ? 'auszug-' + acc.id : 'auszug-' + (bank || 'bank').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  return null;
}

// ---------- Beleg einlesen: erkennen, auslesen, zuordnen, verschlüsselt ablegen ----------
const AREA_CAT = { lohn: 'Einkommen', '3a': 'Vorsorge', auszug: 'Vermögen', zins: 'Vermögen', zugang: 'Steuern', abo: 'Mobilität', erklaerung: 'Steuern', info: 'Sonstiges' };
const TITLE = { lohn: 'Lohnausweis', '3a': 'Säule 3a Bescheinigung', auszug: 'Steuerauszug', zins: 'Zinsausweis', zugang: 'E-Tax Zugangsdaten', abo: 'ÖV-Abo', erklaerung: 'Steuererklärung', info: 'Info (nicht nötig)' };
export async function ingest(file, year, forceItem = null) {
  const s = S(); let type = null, ex = {}, text = '', pages = null;
  if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    try { pages = await pdfLines(new Uint8Array(await file.arrayBuffer())); text = linesText(pages); ({ type } = detect(text, file.name)); ex = type ? extract(type, text) : {}; } catch (e) { /* kein lesbarer Text */ }
  }
  let y = +year;
  if (type === 'erklaerung' && pages) {
    const d = parseDeclaration(pages); y = d.year || y;
    (s.taxYears[y] ||= { rates: {}, checklist: {} }).declared = { values: d.values, at: new Date().toISOString() };
    ex = { ziffern: Object.keys(d.values).length };
  } else if (ex.period) y = ex.period;
  else if (type !== 'info') {
    // Nur eindeutige Angaben zum Steuerjahr – nicht das Ausstellungsdatum (Bescheinigungen kommen im Januar)
    const m = /01\.01\.\s*(20\d\d)\s*(?:-|–|bis)\s*31\.12\.\s*\1/.exec(text) || /(?:Steuerjahr|Beitragsjahr|Jahr|Année|Anno|Periode)\s*:?\s*(20\d\d)/i.exec(text) || /per 31\.\s?12\.\s?(20\d\d)/i.exec(text);
    if (m && Math.abs(+m[1] - y) <= 1) y = +m[1];
  }
  const item = forceItem || (type === 'info' ? 'info' : type === 'erklaerung' ? null : suggestItem(y, type, ex, text));
  const fid = uid(); await putFile(fid, file);
  const bank = ex.bank || bankOf(text);
  const doc = { id: uid(), status: 'done', kind: type === 'erklaerung' ? 'erklaerung' : 'doc', created: new Date().toISOString(), year: y,
    title: `${TITLE[type] || 'Beleg'}${bank ? ' ' + bank : ''} ${y}`, issuer: bank || '', bank, category: AREA_CAT[type] || 'Steuern', tax: type === 'info' ? 'no' : 'yes',
    ziffer: { lohn: '100', '3a': '610', auszug: '800', zins: '800', abo: '500' }[type] || '', file: fid, fileName: file.name, taxItem: item, docType: type, extract: ex, text: text.slice(0, 4000) };
  s.documents.push(doc);
  return doc;
}
