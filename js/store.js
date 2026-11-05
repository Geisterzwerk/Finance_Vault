// =====================================================================
// store.js – App-Zustand (liegt entschlüsselt nur im Arbeitsspeicher)
// =====================================================================
import { saveState } from './vault.js';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const emptyState = () => ({
  version: 1,
  transactions: [],   // Crypto-Transaktionen
  accounts: [],       // Bank, Cash, ETF, 3a, Verbindlichkeiten
  goals: [],          // Ziele mit Meilensteinen
  invoices: [],       // Rechnungen
  imports: {},        // Plattform -> { last, count, mapping }
  raw: {},
  documents: [],      // Dokumente (Scans, PDFs, Steuererklärung, Veranlagung)
  ledger: { addresses: [], last: null },
  server: { url: '', token: '', lastSync: null, lastReminders: '', push: false, status: null },            // Rohdaten von Konto-Auszügen (z. B. BingX), für Neuberechnung
  coins: {},          // Symbol -> { id (CoinGecko), name, location }
  prices: {},         // Symbol -> { chf, change24h, at }
  pricesAt: null,
  taxYears: {},       // Jahr -> { rates, checklist, closed, snapshot }
  settings: { name: 'Jorick', cgKey: '', defaultWallet: 'Ledger', autoLockMin: 5, canton: 'Basel-Landschaft' },
});

let state = emptyState();
const listeners = [];
let timer = null;

export const S = () => state;
export function setState(s) {
  const e = emptyState();
  state = { ...e, ...s, settings: { ...e.settings, ...(s.settings || {}) } };
}
export const onChange = (f) => listeners.push(f);

// Speichern (verschlüsselt, leicht verzögert) + UI neu zeichnen
export function commit(silent = false) {
  if (!silent) listeners.forEach((f) => f());
  clearTimeout(timer);
  timer = setTimeout(() => saveState(state).catch((e) => console.warn('Speichern fehlgeschlagen', e)), 250);
}
export async function flush() { clearTimeout(timer); await saveState(state); }

export function demoState() {
  const s = emptyState();
  const d = (y, m, dd) => new Date(y, m - 1, dd, 10, 0).toISOString();
  const tx = (o) => s.transactions.push({ id: uid(), platform: 'Demo', fee: 0, note: '', extId: '', ...o });
  const day = new Date(2026, 0, 6);
  [82000, 85500, 79000, 88000, 91000, 87000, 93500, 95000, 90500, 97000].forEach((p, i) =>
    tx({ date: new Date(day.getTime() + i * 14 * 864e5).toISOString(), type: 'buy', asset: 'BTC', amount: +(230 / p).toFixed(8), chf: 230, platform: 'Relai' }));
  tx({ date: d(2026, 6, 1), type: 'transfer', asset: 'BTC', amount: 0.015, chf: 0, platform: 'Relai', to: 'Ledger' });
  tx({ date: d(2026, 2, 12), type: 'buy', asset: 'LINK', amount: 60, chf: 780, platform: 'BingX' });
  tx({ date: d(2026, 4, 3), type: 'buy', asset: 'LINK', amount: 70, chf: 1020, platform: 'BingX' });
  tx({ date: d(2026, 8, 20), type: 'sell', asset: 'LINK', amount: 10, chf: 210, platform: 'BingX' });
  tx({ date: d(2026, 3, 9), type: 'buy', asset: 'SOL', amount: 9.25, chf: 1650, platform: 'BingX' });
  tx({ date: d(2026, 5, 2), type: 'buy', asset: 'KAS', amount: 9000, chf: 1900, platform: 'BingX' });
  tx({ date: d(2026, 5, 15), type: 'buy', asset: 'XRP', amount: 582, chf: 940, platform: 'BingX' });
  tx({ date: d(2026, 7, 1), type: 'opening', asset: 'SEI', amount: 6400, chf: null, platform: 'BingX', note: 'Bestand ohne Kaufhistorie' });
  tx({ date: d(2026, 9, 14), type: 'review', asset: 'AVAX', amount: 48, chf: 1450, platform: 'BingX', raw: '- 1450 USDT / + 48 AVAX' });
  s.accounts.push(
    { id: uid(), name: 'Raiffeisen Privat', kind: 'bank', value: 2840, updated: d(2026, 10, 30) },
    { id: uid(), name: 'BLKB Notgroschen', kind: 'bank', value: 7000, updated: d(2026, 10, 30), tag: 'notgroschen' },
    { id: uid(), name: 'VIAC Säule 3a', kind: 'pillar3a', value: 17900, updated: d(2026, 11, 1) },
    { id: uid(), name: 'VIAC Invest', kind: 'securities', value: 4500, updated: d(2026, 11, 1) },
  );
  s.goals = defaultGoals(s);
  s.invoices.push(
    { id: uid(), issuer: 'TEKO Basel', number: '2027-18492', title: 'Semesterrechnung', amount: 2450, due: d(2026, 11, 30).slice(0, 10), status: 'open', category: 'Studium', tax: 'maybe', ziffer: '650', created: d(2026, 11, 2) },
    { id: uid(), issuer: 'Swisscom', number: '88412', title: 'Mobile November', amount: 54.9, due: d(2026, 11, 3).slice(0, 10), status: 'open', category: 'Kommunikation', tax: 'no', created: d(2026, 10, 20) },
    { id: uid(), issuer: 'Krankenkasse', number: 'P-2026-11', title: 'Prämie November', amount: 312.5, due: d(2026, 11, 1).slice(0, 10), status: 'paid', paidAt: d(2026, 10, 28).slice(0, 10), category: 'Versicherung', tax: 'yes', ziffer: '', created: d(2026, 10, 15) },
  );
  return s;
}

export function defaultGoals(s) {
  const ng = (s.accounts || []).find((a) => a.tag === 'notgroschen');
  const g = [
    { id: uid(), name: 'Gesamtvermögen', kind: 'networth', unit: 'CHF', color: 'gold', milestones: [25000, 50000, 75000, 100000, 150000, 250000, 500000, 1000000], reached: {} },
    { id: uid(), name: 'Bitcoin', kind: 'asset', asset: 'BTC', unit: 'BTC', color: 'orange', milestones: [0.01, 0.05, 0.1, 0.25, 0.5, 1], reached: {} },
  ];
  if (ng) g.push({ id: uid(), name: 'Notgroschen', kind: 'account', accountId: ng.id, unit: 'CHF', color: 'green', milestones: [7000], reached: {} });
  g.push({ id: uid(), name: 'Säule 3a', kind: 'category', category: 'pillar3a', unit: 'CHF', color: 'teal', milestones: [25000, 50000, 100000], reached: {} });
  return g;
}
