// =====================================================================
// perf.js – Vermögensanalyse: Snapshots, Einzahlungen vs. Performance, FI
//
// Einzahlungen (= eigenes Geld, das neu dazukommt):
//  · Crypto: Summe aller Käufe (CHF + Gebühr) und Anfangsbestände mit Preis,
//    minus Verkaufserlöse. Tausch Coin↔Coin hebt sich auf (Kauf = Verkauf).
//  · Bank & Cash: jede Veränderung zählt als Sparen/Entnahme (keine Rendite).
//  · Wertschriften / Säule 3a: Einzahlungen, die du beim Aktualisieren des
//    Kontos angibst («davon Einzahlung») – der Rest ist Marktentwicklung.
// Performance = Endwert − Startwert − Einzahlungen (vereinfachte Modified-Dietz-Rendite).
// =====================================================================
import { S } from './store.js';
import { netWorth, hiddenAssets, valueSeries, accountAt } from './calc.js';

const DAY = 864e5;
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// ---------- Snapshots (einmal pro Tag, verschlüsselt im Vault) ----------
export function takeSnapshot() {
  const s = S(); if (!s.pricesAt || Date.now() - new Date(s.pricesAt) > 6 * 36e5) return false;
  const nw = netWorth();
  (s.netSnaps ||= {})[dayKey()] = { net: Math.round(nw.net), crypto: Math.round(nw.crypto), cash: Math.round(nw.cash), securities: Math.round(nw.securities),
    pillar3a: Math.round(nw.pillar3a), liability: Math.round(nw.liability), invested: Math.round(cryptoInvested()) };
  return true;
}

// Netto eingesetztes Geld in Crypto bis Zeitpunkt t
export function cryptoInvested(t = Infinity) {
  const hidden = hiddenAssets(); let v = 0, unknown = 0;
  for (const x of S().transactions) {
    if (hidden.has(x.asset) || new Date(x.date).getTime() > t) continue;
    const chf = x.chf == null || x.chf === '' ? null : +x.chf; const fee = +x.fee || 0;
    if (x.type === 'buy') { if (chf == null) unknown++; else v += chf + fee; }
    else if (x.type === 'opening') { if (chf == null) unknown++; else v += chf; }
    else if (x.type === 'sell') { if (chf != null) v -= chf - fee; }
  }
  cryptoInvested.unknown = unknown;
  return v;
}
// Einzahlungen in Wertschriften/3a zwischen t0 und t1 (aus «davon Einzahlung» beim Aktualisieren)
function accountContrib(a, t0, t1) {
  let v = (a.contribs || []).filter((c) => { const t = new Date(c.at).getTime(); return t > t0 && t <= t1; }).reduce((x, c) => x + (+c.amount || 0), 0);
  // Konto erst im Zeitraum erfasst: der erste erfasste Stand ist eingebrachtes Geld, keine Rendite
  if (accountAt(a, t0) == null) { const first = firstKnown(a); if (first && first.t <= t1) v += first.v; }
  return v;
}
function firstKnown(a) {
  const pts = [...(a.history || []).map((h) => ({ t: new Date(h.at).getTime(), v: +h.value || 0 })), { t: new Date(a.updated).getTime(), v: +a.value || 0 }].filter((x) => Number.isFinite(x.t)).sort((x, y) => x.t - y.t);
  return pts[0] || null;
}

// Analyse für einen Zeitraum (Tage zurück)
export function analysis(days = 365) {
  const s = S(); const now = Date.now(); const t0 = now - days * DAY;
  const { pts } = valueSeries(days, 'net');
  const series = [];
  const start = pts[0] ? pts[0].v : 0;
  const ci0 = cryptoInvested(t0);
  for (const p of pts) {
    let flows = cryptoInvested(p.t) - ci0;
    for (const a of s.accounts) {
      const v0 = accountAt(a, t0) ?? 0, v1 = accountAt(a, p.t) ?? 0;
      if (a.kind === 'bank' || a.kind === 'cash') flows += v1 - v0;
      else if (a.kind === 'liability') flows -= v1 - v0;
      else flows += accountContrib(a, t0, p.t);
    }
    series.push({ t: p.t, v: start + flows });
  }
  const end = pts.length ? pts[pts.length - 1].v : netWorth().net;
  const flows = series.length ? series[series.length - 1].v - start : 0;
  const gain = end - start - flows;
  const base = start + flows / 2;
  const by = { crypto: cryptoInvested() - ci0, cash: 0, depot: 0 };
  for (const a of s.accounts) {
    if (a.kind === 'bank' || a.kind === 'cash') by.cash += (accountAt(a, now) ?? 0) - (accountAt(a, t0) ?? 0);
    else if (a.kind !== 'liability') by.depot += accountContrib(a, t0, now);
  }
  return { pts, contrib: series, start, end, flows, gain, pct: base > 0 ? (gain / base) * 100 : null, by, unknown: cryptoInvested.unknown || 0 };
}

// ---------- Financial Independence ----------
export const fiCfg = () => (S().fi ||= { expenses: 3000, swr: 3.5, ret: 4, save: 1000, excludeNotgroschen: true });
export function fiCalc() {
  const s = S(); const c = fiCfg(); const nw = netWorth();
  const ng = s.accounts.find((a) => a.tag === 'notgroschen');
  // Investiertes Vermögen: alles ausser Notgroschen (und abzüglich Schulden)
  const current = Math.max(0, nw.net - (c.excludeNotgroschen && ng ? +ng.value || 0 : 0));
  const target = (c.expenses * 12) / (c.swr / 100);
  const r = Math.pow(1 + c.ret / 100, 1 / 12) - 1;
  let v = current, m = 0; const proj = [{ t: Date.now(), v }];
  while (v < target && m < 12 * 60) { v = v * (1 + r) + c.save; m++; if (m % 3 === 0) proj.push({ t: Date.now() + m * 30.44 * DAY, v }); }
  return { current, target, progress: target > 0 ? Math.min(1, current / target) : 0, months: v >= target ? m : null, proj, monthlyIncome: (current * c.swr) / 100 / 12, cfg: c };
}
export const snapshotsCount = () => Object.keys(S().netSnaps || {}).length;
