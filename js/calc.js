// =====================================================================
// calc.js – Berechnungslogik (Durchschnittskosten-Methode)
// Bestand, Ø Kaufpreis, investiert, unrealisiert, realisiert, Gebühren,
// Datenqualität, Nettovermögen, Bestand per Stichtag, Meilensteine.
// =====================================================================
import { S } from './store.js';

export const TYPES = {
  buy: { l: 'Kauf', c: 'green' },
  sell: { l: 'Verkauf', c: 'red' },
  transfer: { l: 'Transfer', c: 'blue' },
  reward: { l: 'Reward / Rebate', c: 'purple' },
  fee: { l: 'Gebühr', c: 'grey' },
  opening: { l: 'Anfangsbestand', c: 'teal' },
  review: { l: 'Bitte zuordnen', c: 'amber' },
};

export const ACCOUNT_KINDS = {
  bank: { l: 'Bank & Cash', group: 'cash' },
  cash: { l: 'Bargeld', group: 'cash' },
  securities: { l: 'Wertschriften / ETF', group: 'securities' },
  pillar3a: { l: 'Säule 3a', group: 'pillar3a' },
  liability: { l: 'Verbindlichkeit', group: 'liability' },
};

const EPS = 1e-10;

// Holdings bis (inkl.) Stichtag berechnen
export function holdings(until = null) {
  const s = S();
  const end = until ? new Date(until).getTime() : Infinity;
  const txs = s.transactions
    .filter((t) => t.type !== 'review' && new Date(t.date).getTime() <= end)
    .sort((a, b) => new Date(a.date) - new Date(b.date) || (a.seq || 0) - (b.seq || 0));
  const map = {};
  const h = (a) => (map[a] ||= {
    asset: a, qty: 0, cost: 0, unknownQty: 0, realized: 0, realizedUnknown: false, fees: 0, bought: 0, sold: 0,
    negative: false, platforms: new Set(), lastLocation: null, txCount: 0, missingChf: 0,
  });
  for (const t of txs) {
    const x = h(t.asset);
    x.txCount++;
    const amt = Math.abs(Number(t.amount) || 0);
    const chf = t.chf == null || t.chf === '' ? null : Number(t.chf);
    const fee = Number(t.fee) || 0;
    if (t.platform) x.platforms.add(t.platform);
    switch (t.type) {
      case 'buy':
        x.qty += amt; x.bought += amt;
        if (chf == null) { x.unknownQty += amt; x.missingChf++; } else x.cost += chf + fee;
        x.fees += fee;
        if (!x.lastLocation) x.lastLocation = t.platform;
        break;
      case 'opening':
        x.qty += amt;
        if (chf == null) x.unknownQty += amt; else x.cost += chf;
        if (!x.lastLocation) x.lastLocation = t.platform;
        break;
      case 'reward':
        x.qty += amt; // Kostenbasis 0
        break;
      case 'sell': {
        if (amt > x.qty + 1e-8) x.negative = true;
        const q = Math.min(amt, x.qty);
        if (x.unknownQty > EPS || chf == null) {
          // Kostenbasis teilweise unbekannt: kein Gewinn berechnen, anteilig ausbuchen
          x.realizedUnknown = true;
          const share = x.qty > EPS ? q / x.qty : 0;
          x.cost -= x.cost * share; x.unknownQty -= x.unknownQty * share;
          if (chf == null) x.missingChf++;
        } else {
          const costOut = x.qty > EPS ? (x.cost / x.qty) * q : 0;
          x.realized += (chf - fee) - costOut;
          x.cost -= costOut;
        }
        x.fees += fee; x.qty -= q; x.sold += amt;
        break;
      }
      case 'fee': {
        const q = Math.min(amt, x.qty);
        if (x.qty > EPS) x.unknownQty -= x.unknownQty * (q / x.qty);
        x.qty -= q; // Kosten bleiben -> Ø-Preis steigt
        x.fees += chf || 0;
        break;
      }
      case 'transfer':
        if (fee) { const q = Math.min(fee, x.qty); x.qty -= q; }
        if (t.to) x.lastLocation = t.to;
        break;
    }
    if (x.qty < EPS) { x.qty = 0; x.cost = 0; x.unknownQty = 0; }
  }
  for (const x of Object.values(map)) {
    const unknown = x.unknownQty > Math.max(EPS, x.qty * 1e-6);
    x.avg = x.qty > EPS && !unknown ? x.cost / x.qty : null;
    x.unknownShare = x.qty > EPS ? Math.min(1, x.unknownQty / x.qty) : 0;
    // Ø-Preis des bekannten Teils (nur als Hinweis, nicht für Gewinn/Verlust)
    const knownQty = x.qty - x.unknownQty;
    x.avgKnown = unknown && knownQty > EPS && x.cost > 0 ? x.cost / knownQty : null;
    x.location = (s.coins[x.asset] && s.coins[x.asset].location) || x.lastLocation || '-';
    x.platforms = [...x.platforms];
    x.quality = x.negative || unknown ? 'missing' : x.missingChf ? 'check' : 'ok';
  }
  return map;
}

// Mit Live-Kursen kombinieren
export function portfolio() {
  const s = S();
  const list = Object.values(holdings()).filter((x) => x.qty > 1e-8 || Math.abs(x.realized) > 0.005);
  let total = 0, cost = 0, unreal = 0, realized = 0;
  for (const x of list) {
    const p = s.prices[x.asset];
    x.price = p ? p.chf : null;
    x.change24h = p ? p.change24h : null;
    x.value = x.price != null ? x.qty * x.price : null;
    x.unreal = x.value != null && x.avg != null ? x.value - x.cost : null;
    x.unrealPct = x.unreal != null && x.cost > 0 ? (x.unreal / x.cost) * 100 : null;
    if (x.value != null) total += x.value;
    if (x.unreal != null) { unreal += x.unreal; cost += x.cost; }
    realized += x.realized;
  }
  list.sort((a, b) => (b.value || 0) - (a.value || 0));
  return { list, total, unreal, unrealPct: cost > 0 ? (unreal / cost) * 100 : null, realized, held: list.filter((x) => x.qty > 1e-8) };
}

export function netWorth() {
  const s = S();
  const pf = portfolio();
  const g = { crypto: pf.total, securities: 0, pillar3a: 0, cash: 0, liability: 0 };
  for (const a of s.accounts) g[(ACCOUNT_KINDS[a.kind] || ACCOUNT_KINDS.bank).group] += Number(a.value) || 0;
  const assets = g.crypto + g.securities + g.pillar3a + g.cash;
  return { ...g, assets, net: assets - g.liability, pf };
}

export function goalValue(goal, nw = netWorth()) {
  const s = S();
  switch (goal.kind) {
    case 'networth': return nw.net;
    case 'asset': { const x = holdings()[goal.asset]; return x ? x.qty : 0; }
    case 'account': { const a = s.accounts.find((q) => q.id === goal.accountId); return a ? Number(a.value) || 0 : 0; }
    case 'category': return nw[goal.category] || 0;
    case 'crypto': return nw.crypto;
    default: return 0;
  }
}

export function goalProgress(goal, nw) {
  const v = goalValue(goal, nw);
  const ms = [...goal.milestones].sort((a, b) => a - b);
  const reachedCount = ms.filter((m) => goal.reached[m]).length;
  const next = ms.find((m) => !goal.reached[m] && v < m) ?? ms.find((m) => !goal.reached[m]) ?? null;
  return { value: v, next, pct: next ? Math.min(1, v / next) : 1, reachedCount, total: ms.length, done: !next };
}

// Neu erreichte Meilensteine (Konfetti nur beim ersten Überschreiten).
// Ohne Kurse wird Vermögen/Crypto nicht geprüft, damit nichts falsch ausgelöst wird.
export function checkMilestones() {
  const s = S();
  const nw = netWorth();
  const fresh = [];
  for (const g of s.goals) {
    if ((g.kind === 'networth' || g.kind === 'crypto') && !s.pricesAt && s.transactions.length) continue;
    const v = goalValue(g, nw);
    for (const m of g.milestones) {
      if (!g.reached[m] && v >= m) { g.reached[m] = new Date().toISOString(); fresh.push({ goal: g, value: m }); }
    }
  }
  return fresh;
}

export const reviewCount = () => S().transactions.filter((t) => t.type === 'review').length;
export const yearEndHoldings = (year) => holdings(new Date(year, 11, 31, 23, 59, 59).toISOString());
