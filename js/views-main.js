// =====================================================================
// views-main.js – Übersicht, Invest, Coin-Detail, Konten, Ziele
// =====================================================================
import { S, commit, uid, deleteTx } from './store.js';
import { TYPES, ACCOUNT_KINDS, portfolio, netWorth, holdings, goalProgress, reviewCount, typeInfo, staleMilestones, resetMilestones, valueSeries } from './calc.js';
import { coinId } from './prices.js';
import { closingDue } from './taxpack.js';
import { openEstimate, missingOpenings } from './estimate.js';
import { ring, legend, area, progress, lastId, SLOTS, OTHER, gc } from './charts.js';
import { reconcile } from './auto.js';
import { calendar as taxCalendar } from './taxcal.js';
import { loadHistory } from './prices.js';
import {
  esc, chf, qty, price, pct, cls, dmy, dmyShort, hm, ago, daysUntil, greeting, longDate, icon,
  openSheet, closeSheet, toast, chips, chipVal, bindChips, confetti, rerender,
} from './ui.js';

export const ui = { investTab: 'crypto' };
export const TAX_TOTAL = 10;

const fmtGoal = (v, unit) => (unit === 'CHF' ? chf(v) : `${qty(v)} ${unit}`);
export function openInvoicesSummary() {
  const open = S().invoices.filter((i) => i.status === 'open');
  return { open, sum: open.reduce((a, i) => a + (+i.amount || 0), 0), over: open.filter((i) => i.due && daysUntil(i.due) < 0).length };
}
const avgCell = (x) => (x.avg != null ? (x.estimated ? `<span class="amber" title="geschätzt">≈ ${price(x.avg)}</span>` : `<span class="mut">${price(x.avg)}</span>`) : x.avgKnown != null ? `<span class="amber">≈ ${price(x.avgKnown)}</span>` : '<span class="amber">fehlt</span>');

// =====================================================================
// ÜBERSICHT
// =====================================================================
// Farben: Kategorien fest, Coins behalten ihre einmal vergebene Farbe (folgt dem Coin, nicht dem Rang)
export const GOAL_COLOR = { gold: SLOTS[0], orange: SLOTS[0], blue: SLOTS[1], teal: SLOTS[1], green: SLOTS[2], purple: SLOTS[4] };
const CAT = [['crypto', 'Crypto', SLOTS[0]], ['pillar3a', 'Säule 3a', SLOTS[1]], ['securities', 'Wertschriften', SLOTS[2]], ['cash', 'Bank & Cash', SLOTS[3]]];
function coinSegments(held) {
  const s = S(); const used = new Set(); const top = held.filter((x) => x.value > 0).slice(0, 5);
  // BTC bekommt – wenn noch frei – das Gold (Slot 0); Farben bleiben danach fest beim Coin
  const btc = top.find((x) => x.asset === 'BTC');
  if (btc && (s.coins.BTC || {}).slot == null && !held.some((x) => x !== btc && (s.coins[x.asset] || {}).slot === 0)) s.coins.BTC = { ...(s.coins.BTC || {}), slot: 0 };
  for (const x of held) { const sl = (s.coins[x.asset] || {}).slot; if (sl != null && top.includes(x)) used.add(sl); }
  const segs = top.map((x) => {
    let sl = (s.coins[x.asset] || {}).slot;
    if (sl == null || (used.has(sl) && top.find((y) => y !== x && (s.coins[y.asset] || {}).slot === sl))) {
      sl = [0, 1, 2, 3, 4].find((k) => !used.has(k)); used.add(sl);
      s.coins[x.asset] = { ...(s.coins[x.asset] || {}), slot: sl };
    }
    return { label: x.asset, value: x.value, color: SLOTS[sl] ?? OTHER, sub: qty(x.qty) };
  });
  const rest = held.filter((x) => x.value > 0 && !top.includes(x));
  if (rest.length) segs.push({ label: 'Andere', value: rest.reduce((a, x) => a + x.value, 0), color: OTHER, sub: rest.length + ' Coins' });
  return segs;
}
export const ui0 = { range: 90 };
function trendCard(kind, title) {
  const R = ui0.range;
  const { pts, missing } = valueSeries(R, kind);
  const first = pts.find((p) => !p.gap) || pts[0]; const last = pts[pts.length - 1];
  const delta = first && last ? last.v - first.v : null;
  const dp = first && first.v ? (delta / first.v) * 100 : null;
  return `<div class="card">
    <div class="row"><div class="lbl grow">${title}</div>
      <div class="seg mini" data-range>${[[30, '1M'], [90, '3M'], [365, '1J']].map(([d, l]) => `<button class="${R === d ? 'sel' : ''}" data-r="${d}">${l}</button>`).join('')}</div></div>
    ${delta != null ? `<div class="trend-h"><span class="${cls(delta)}">${chf(delta, 0, true)}</span><span class="mut small">${pct(dp)} · ${R === 365 ? '12 Monate' : R === 90 ? '3 Monate' : '30 Tage'}</span></div>` : ''}
    ${area(pts, { color: kind === 'crypto' ? SLOTS[0] : SLOTS[0], fmt: (v) => chf(v), label: title, height: 150 })}
    ${missing.length ? `<div class="small mut mt">Ohne Kursverlauf: ${esc(missing.join(', '))} – diese Tage sind zu tief. <button class="link sm" data-act="loadhist" data-syms="${esc(missing.join(','))}">Verlauf laden</button></div>` : ''}
  </div>`;
}
function bindTrend(el) {
  el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-r]'); if (r) { ui0.range = +r.dataset.r; dispatchEvent(new Event('rerender')); return; }
    const h = e.target.closest('[data-act=loadhist]'); if (!h) return;
    if (!navigator.onLine) return toast('Offline');
    h.disabled = true;
    await loadHistory(h.dataset.syms.split(','), (i, n, sym) => { h.textContent = `Lade ${sym} (${i}/${n}) …`; });
    dispatchEvent(new Event('rerender'));
  });
}

// Status der Automatik: woher kommen die Daten, wie frisch sind sie, stimmt der Abgleich?
function autoCard() {
  const s = S(); const c = s.server || {};
  if (!c.token && !(s.ledger.addresses || []).length) return '';
  const rc = reconcile();
  const fresh = (iso, h) => iso && Date.now() - new Date(iso) < h * 36e5;
  const item = (ok, label, detail) => `<div class="txr">${ok ? icon('ok') : icon('warn')}<span class="grow">${label}</span><span class="small mut">${detail}</span></div>`;
  return `<div class="card clickable" data-go="#/vault/ledger"><div class="row"><div class="lbl grow">Automatik</div><span class="chev">›</span></div>
    ${c.token ? item(c.status && c.status.ok, 'Server', c.lastSync ? 'Abgleich ' + ago(c.lastSync) : 'noch nie') : ''}
    ${item(fresh(s.pricesAt, 1), 'Kurse', s.pricesAt ? hm(s.pricesAt) + ' · ' + dmyShort(s.pricesAt) : 'fehlen')}
    ${c.token && c.bingx ? item(fresh(c.bingxLast && new Date(c.bingxLast).toISOString(), 12), 'BingX', c.bingxLast ? 'Server-Sync ' + ago(new Date(c.bingxLast)) : 'wartet') : ''}
    ${rc.ready ? item(!rc.bad.length, 'Abgleich Ledger + BingX', rc.bad.length ? `${rc.bad.length} Abweichung${rc.bad.length > 1 ? 'en' : ''}: ${esc(rc.bad.slice(0, 3).map((r) => r.k).join(', '))}` : 'alles stimmt') : (s.ledger.addresses || []).length ? item(false, 'Abgleich Ledger', 'noch nicht geprüft') : ''}
  </div>`;
}

export function dashboard() {
  gc();
  const s = S(); const nw = netWorth(); const rc = reviewCount();
  const g1 = s.goals.find((g) => g.kind === 'networth');
  const g2 = s.goals.find((g) => g.kind === 'asset' && g.asset === 'BTC');
  const inv = openInvoicesSummary();
  const yr = new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();
  const ck = (s.taxYears[yr] || {}).checklist || {};
  const taxDone = Object.values(ck).filter(Boolean).length;
  const live = s.pricesAt && Date.now() - new Date(s.pricesAt) < 15 * 60e3;
  const missing = nw.pf.held.filter((x) => x.quality === 'missing').length;
  const closing = closingDue();
  const inboxDocs = (s.documents || []).filter((d) => d.status === 'inbox').length;
  const segs = CAT.map(([k, l, c]) => ({ label: l, value: Math.max(0, nw[k]), color: c }));
  const goalCard = (g) => {
    if (!g) return '';
    const p = goalProgress(g, nw);
    return `<div class="card clickable row" data-go="#/ziele">${progress(p.pct, GOAL_COLOR[g.color] || SLOTS[0])}
      <div class="grow"><div class="lbl">${g.kind === 'networth' ? 'Nächster Meilenstein' : esc(g.name) + '-Ziel'}</div>
      <div class="big2">${p.done ? 'Alle erreicht' : fmtGoal(p.next, g.unit)}</div>
      <div class="small mut">${p.done ? 'Neue Meilensteine unter Ziele' : `noch ${fmtGoal(p.next - p.value, g.unit)}`}</div></div><span class="chev">›</span></div>`;
  };
  const center = { label: 'Nettovermögen', value: chf(nw.net), sub: nw.pf.unrealPct != null ? `Crypto ${pct(nw.pf.unrealPct)} unrealisiert` : longDate() };
  return {
    title: `${greeting()}, ${esc(s.settings.name)}`,
    sub: `${longDate()} <span class="live ${live ? 'on' : ''}">${live ? '● Kurse live · ' + hm(s.pricesAt) : s.pricesAt ? 'Kurse ' + dmyShort(s.pricesAt) + ' ' + hm(s.pricesAt) : 'Noch keine Kurse'}</span>`,
    html: `
    <div class="card hero ringwrap">
      ${ring(segs, { size: 236, thick: 11, center, fmt: (v) => chf(v) })}
      ${legend(segs, Math.max(1, segs.reduce((a, x) => a + x.value, 0)), (v) => chf(v), lastId())}
      ${nw.liability ? `<div class="small mut mt">Verbindlichkeiten ${chf(-nw.liability)} sind im Nettovermögen abgezogen.</div>` : ''}
    </div>
    ${autoCard()}
    ${trendCard('net', 'Verlauf Nettovermögen')}
    ${goalCard(g1)}
    <div class="grid2">
      <div class="card clickable" data-go="#/rechnungen"><div class="lbl">Rechnungen</div><div class="big2">${chf(inv.sum)}</div>
        <div class="small ${inv.over ? 'neg' : inv.open.length ? 'amber' : 'pos'}">${inv.open.length ? `${inv.open.length} offen${inv.over ? ' · ' + inv.over + ' überfällig' : ''}` : 'Alles bezahlt'}</div></div>
      ${(() => { const nx = taxCalendar().find((x) => !x.done); return nx ? `<div class="card clickable" data-go="#/steuern"><div class="lbl nowrap">Steuerfrist</div><div class="big1">${esc(nx.type === 'file' ? 'Erklärung ' + nx.year : nx.title)}</div>
        <div class="small ${nx.days < 0 ? 'neg' : nx.days <= 21 ? 'amber' : 'mut'}">${nx.days < 0 ? 'überfällig' : nx.days === 0 ? 'heute' : 'in ' + nx.days + ' Tagen'} · ${nx.due.split('-').reverse().join('.')}</div></div>` : ''; })()}
    </div>
    <div>
      <div class="card clickable row" data-go="#/steuern">${progress(taxDone / TAX_TOTAL, SLOTS[2], 46)}<div class="grow"><div class="lbl nowrap">Checkliste Steuererklärung</div><div class="big1">${yr}</div><div class="small mut">${taxDone} von ${TAX_TOTAL}</div></div></div>
    </div>
    ${closing ? `<div class="card clickable row goldb" data-go="#/steuern">${icon('warn')}<div class="grow"><b>Jahresabschluss ${closing}</b><div class="small mut">Daten prüfen, Bestand per 31.12. einfrieren, Steuerpaket erstellen</div></div><span class="chev">›</span></div>` : ''}
    ${rc + inboxDocs ? `<div class="card clickable row" data-go="#/vault/inbox">${icon('warn')}<div class="grow"><b>Finance Inbox</b><div class="small mut">${[rc ? rc + ' Transaktion' + (rc > 1 ? 'en' : '') + ' zuordnen' : '', inboxDocs ? inboxDocs + ' Dokument' + (inboxDocs > 1 ? 'e' : '') + ' prüfen' : ''].filter(Boolean).join(' · ')}</div></div><span class="chev">›</span></div>` : ''}
    ${missing ? `<div class="card clickable row" data-go="#/invest">${icon('warn')}<div class="grow"><b>Kaufhistorie unvollständig</b><div class="small mut">Bei ${missing} Coin${missing > 1 ? 's' : ''} fehlt ein Teil der Käufe.</div></div><span class="chev">›</span></div>` : ''}
    ${goalCard(g2)}
    ${!s.transactions.length && !s.accounts.length ? `<div class="card"><b>Los geht's</b><div class="small mut">Importiere deine BingX- und Relai-Exporte unter Vault, erfasse deine Konten unter Invest, oder lade Demo-Daten unter Vault › Einstellungen.</div>
      <div class="grid2 mt"><button class="btn gold" data-go="#/vault">Importieren</button><button class="btn line" data-go="#/invest">Konten</button></div></div>` : ''}`,
    bind: bindTrend,
  };
}

// =====================================================================
// INVEST
// =====================================================================
export function invest() {
  const s = S(); const pf = portfolio(); const nw = netWorth();
  const t = ui.investTab;
  const tabs = `<div class="seg">${[['crypto', 'Crypto'], ['konten', 'Konten'], ['kurse', 'Kurse']].map(([k, l]) => `<button class="${t === k ? 'sel' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (t === 'crypto') {
    const done = pf.list.filter((x) => x.qty <= 1e-8);
    const segs = coinSegments(pf.held);
    body = `<div class="card hero ringwrap">
      ${ring(segs, { size: 220, thick: 11, center: { label: 'Crypto', value: chf(pf.total), sub: pf.unrealPct != null ? `${chf(pf.unreal, 0, true)} · ${pct(pf.unrealPct)}` : '' }, fmt: (v) => chf(v) })}
      ${legend(segs, Math.max(1, pf.total), (v) => chf(v), lastId())}
      <div class="small mut mt">Unrealisiert nur für Coins mit vollständiger Kaufhistorie · Realisiert ${chf(pf.realized, 0, true)}${pf.realizedUnknown ? ' <span class="amber">(teilweise unbekannt)</span>' : ''}</div>
      ${pf.missingPrice ? `<div class="small amber">${pf.missingPrice} Coin${pf.missingPrice > 1 ? 's' : ''} ohne Kurs – nicht im Total enthalten</div>` : ''}</div>
      ${trendCard('crypto', 'Verlauf Crypto')}
      ${missingOpenings().length ? `<div class="card row clickable goldb" data-act="estimate">${icon('warn')}<div class="grow"><b>Kaufpreise fehlen (${missingOpenings().length})</b><div class="small mut">Käufe stehen nicht im Export. Mit historischem Kurs schätzen?</div></div><span class="gold">›</span></div>` : ''}
      <div class="thead"><span>Coin</span><span>Ø Kauf</span><span>Wert / P/L</span></div>
      ${pf.held.map((x) => `<div class="coin clickable" data-coin="${esc(x.asset)}">
        <div class="cic">${esc(x.asset[0])}</div><div class="grow"><b>${esc(x.asset)}</b><div class="small mut">${qty(x.qty)}${x.unverified ? ' · <span class="amber">Kurs prüfen</span>' : ''}</div></div>
        <div class="avg">${avgCell(x)}</div>
        <div class="right"><b>${x.value != null ? chf(x.value) : '–'}</b><div class="small ${x.quality === 'missing' ? 'amber' : cls(x.unrealPct)}">${x.quality === 'missing' ? 'Historie fehlt' : pct(x.unrealPct)}</div></div></div>`).join('')
        || '<div class="card mut">Noch keine Crypto-Transaktionen. Importiere sie unter Vault.</div>'}
      ${done.length ? `<div class="lbl mt">Komplett verkauft</div>${done.map((x) => `<div class="coin clickable" data-coin="${esc(x.asset)}"><div class="cic">${esc(x.asset[0])}</div><b class="grow">${esc(x.asset)}</b><div class="right ${x.realizedUnknown ? 'amber' : cls(x.realized)}">${x.realizedUnknown ? 'Gewinn unbekannt' : chf(x.realized, 0, true)}</div></div>`).join('')}` : ''}
      <div class="small mut mt">≈ = Ø-Preis geschätzt oder nur für den Teil mit bekannter Kaufhistorie.${S().settings.ignoredAssets?.length ? ` Ausgeblendet: ${esc(S().settings.ignoredAssets.join(', '))}.` : ''}</div>
      <button class="btn line block mt" data-act="addtx">＋ Transaktion manuell erfassen</button>`;
  } else if (t === 'konten') {
    body = `<div class="card hero"><div class="lbl">Ohne Crypto</div><div class="serif huge">${chf(nw.cash + nw.securities + nw.pillar3a - nw.liability)}</div></div>
      ${Object.entries(ACCOUNT_KINDS).map(([k, g]) => { const list = s.accounts.filter((a) => a.kind === k); return list.length ? `<div class="lbl mt">${g.l}</div>${list.map((a) => `
        <div class="card row clickable" data-acc="${a.id}"><div class="grow"><b>${esc(a.name)}</b><div class="small ${Date.now() - new Date(a.updated) > 40 * 864e5 ? 'amber' : 'mut'}">Stand ${dmy(a.updated)} · ${ago(a.updated)}</div></div>
        <b class="${k === 'liability' ? 'neg' : ''}">${chf(k === 'liability' ? -a.value : a.value)}</b></div>`).join('')}` : ''; }).join('')}
      <button class="btn gold block mt" data-act="addacc">＋ Konto / Depot erfassen</button>`;
  } else {
    const syms = Object.keys(holdings());
    body = `<div class="card row"><div class="grow"><b class="${s.pricesAt && Date.now() - new Date(s.pricesAt) < 15 * 60e3 ? 'pos' : 'amber'}">${navigator.onLine ? (s.pricesAt ? 'Kurse aktualisiert' : 'Noch keine Kurse') : 'Offline'}</b>
      <div class="small mut">${s.pricesAt ? `Stand ${dmy(s.pricesAt)} · ${hm(s.pricesAt)} · ` : ''}Quelle CoinGecko</div></div><button class="btn line sm" data-act="refresh">↻ Kurse</button></div>
      ${syms.map((sym) => { const p = s.prices[sym]; return `<div class="coin clickable" data-coin="${esc(sym)}"><b class="grow">${esc(sym)}</b><span class="mut small">${esc(coinId(sym) || 'unbekannt')}</span>
        <b class="right w110">${p ? price(p.chf) : '–'}</b><span class="right w60 small ${cls(p && p.change24h)}">${p && p.change24h != null ? pct(p.change24h) : ''}</span></div>`; }).join('')}
      <div class="small mut mt">Ohne Internet bleibt der letzte Kurs mit Datum stehen. Live-Kurse werden nie für die Steuer verwendet.</div>`;
  }
  return {
    title: 'Invest', sub: t === 'crypto' ? 'Ø Kaufpreis und Performance je Coin' : t === 'konten' ? 'Bank, ETF, Säule 3a, Verbindlichkeiten' : 'Live beim Öffnen, offline mit letztem Stand',
    html: tabs + body,
    bind: (el) => { bindTrend(el); el.addEventListener('click', (e) => {
      if (e.target.closest('[data-r], [data-act=loadhist]')) return;
      const tb = e.target.closest('[data-tab]'); if (tb) { ui.investTab = tb.dataset.tab; dispatchEvent(new Event('rerender')); return; }
      const c = e.target.closest('[data-coin]'); if (c) return openCoin(c.dataset.coin);
      const a = e.target.closest('[data-acc]'); if (a) return openAccount(S().accounts.find((x) => x.id === a.dataset.acc));
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'addacc') openAccount();
      if (b.dataset.act === 'addtx') openTx();
      if (b.dataset.act === 'estimate') openEstimate();
      if (b.dataset.act === 'refresh') dispatchEvent(new Event('refreshprices'));
    }); },
  };
}

// ---------- Coin-Detail ----------
export function openCoin(sym) {
  openSheet({
    title: sym, live: true,
    render: () => {
      const s = S();
      const x = portfolio().list.find((q) => q.asset === sym) || { asset: sym, qty: 0, cost: 0, realized: 0, fees: 0, platforms: [], quality: 'ok' };
      const txs = s.transactions.filter((t) => t.asset === sym).sort((a, b) => new Date(b.date) - new Date(a.date));
      const p = s.prices[sym];
      return `
      <div class="small mut">${esc(sym)} · gekauft bei ${esc((x.platforms || []).join(', ') || '–')} · liegt auf ${esc(x.location || '–')}</div>
      <div class="card hero mt"><div class="lbl">Aktueller Bestand</div><div class="serif huge">${qty(x.qty)} ${esc(sym)}</div>
        <div class="grid2"><div><div class="small mut">Wert</div><b>${chf(x.value)}</b></div><div><div class="small mut">Kurs ${p ? `<span class="pos">● ${Date.now() - new Date(p.at) < 15 * 60e3 ? 'LIVE' : dmyShort(p.at)}</span>` : ''}</div><b>${price(x.price)}</b></div></div>
        <div class="small mt ${x.quality === 'ok' ? 'pos' : 'amber'}">Datenqualität: ${x.quality === 'ok' ? 'vollständig' : x.quality === 'check' ? 'prüfen (CHF-Wert fehlt bei einzelnen Transaktionen)' : `Kaufhistorie fehlt für ${((x.unknownShare || 0) * 100).toFixed(0)} % des Bestands`}</div></div>
      ${(() => {
        const c = (s.histCache || {})[coinId(sym) || ''];
        const pts = c && c.p ? c.p.filter(([ms]) => Date.now() - ms <= 366 * 864e5).map(([t, v]) => ({ t, v })) : [];
        if (pts.length && p) pts.push({ t: Date.now(), v: p.chf });
        const first = pts[0], last = pts[pts.length - 1];
        return `<div class="card"><div class="lbl">Kurs 12 Monate</div>
          ${first ? `<div class="trend-h"><span>${price(last.v)}</span><span class="small ${cls(last.v - first.v)}">${pct(((last.v - first.v) / first.v) * 100)}</span></div>` : ''}
          ${pts.length > 1 ? area(pts, { color: SLOTS[(s.coins[sym] || {}).slot ?? 0] || SLOTS[0], fmt: (v) => price(v), label: `Kurs ${sym}`, ref: x.avg != null ? { v: x.avg, label: x.estimated ? 'Ø ≈' : 'Ø Kauf' } : null })
            : `<button class="btn line block" data-act="loadhist">Kursverlauf laden</button>`}</div>`;
      })()}
      <div class="grid2">
        <div class="card"><div class="lbl">Ø Kaufpreis</div><div class="serif big2 ${x.estimated ? 'amber' : ''}">${x.avg != null ? (x.estimated ? '≈ ' : '') + price(x.avg) : 'nicht verfügbar'}</div>${x.estimated ? '<div class="small amber">teilweise geschätzt</div>' : ''}
          ${x.avgKnown != null ? `<div class="small amber">≈ ${price(x.avgKnown)} für den bekannten Teil</div>` : ''}<div class="small mut">Investiert (bekannt)</div><b>${chf(x.cost)}</b></div>
        <div class="card"><div class="lbl">Unrealisiert</div><div class="serif big2 ${cls(x.unreal)}">${chf(x.unreal, 0, true)}</div><div class="small mut">Performance</div><b class="${cls(x.unrealPct)}">${pct(x.unrealPct)}</b></div>
      </div>
      <div class="card row"><div class="grow"><div class="small mut">Realisierter Gewinn</div><b class="${x.realizedUnknown ? 'amber' : cls(x.realized)}">${x.realizedUnknown ? 'teilweise unbekannt' : chf(x.realized, 2, true)}</b></div><div class="right"><div class="small mut">Gebühren</div><b>${chf(x.fees, 2)}</b></div></div>
      ${x.quality === 'missing' ? `<div class="note amber">Für einen Teil des Bestands fehlt die Kaufhistorie (Anfangsbestand ohne Preis). Trag den echten Kaufbetrag im Anfangsbestand nach oder lass ihn schätzen. Ohne deine Zustimmung wird kein Ø-Preis erfunden.<button class="btn line sm mt" data-act="estimate">Kaufpreis schätzen …</button></div>` : ''}
      <div class="lbl mt">Transaktionen (${txs.length})</div>
      ${txs.slice(0, 200).map((t) => `<div class="txr clickable" data-tx="${t.id}"><i class="dotc ${typeInfo(t.type).c}"></i><div class="grow"><b>${esc(typeInfo(t.type).l)}</b><div class="small mut">${dmyShort(t.date)} · ${esc(t.platform || '')}${t.to ? ' › ' + esc(t.to) : ''}</div></div>
        <div class="right"><b>${t.type === 'sell' || t.type === 'fee' ? '-' : t.type === 'transfer' ? '' : '+'}${qty(t.amount)}</b><div class="small ${t.estimate ? 'amber' : 'mut'}">${t.type === 'transfer' ? (t.feeQty ? 'Gebühr ' + qty(t.feeQty) : 'kein Kauf') : t.type === 'reward' ? 'Kosten 0' : t.type === 'ignore' ? 'zählt nicht' : t.chf != null ? (t.estimate ? '≈ ' : '') + chf(t.chf, 2) : 'CHF fehlt'}</div></div></div>`).join('')}
      <div class="lbl mt">Einstellungen</div>
      ${(s.coins[sym] || {}).auto ? `<div class="note amber"><b>Kurs automatisch zugeordnet:</b> «${esc(s.coins[sym].name || s.coins[sym].id)}» (${esc(s.coins[sym].id)}). Gleiche Kürzel gibt es oft mehrfach – auch bei Scam-Coins. Bis du die ID mit «Speichern» bestätigst, zählt ${esc(sym)} nicht für Meilensteine. Stimmt er nicht: richtige ID von coingecko.com eintragen oder Coin ausblenden.</div>` : ''}
      <label class="field"><span>CoinGecko-ID (für Kurse)</span><input name="cgid" value="${esc(coinId(sym) || '')}" placeholder="z. B. kaspa"></label>
      <label class="field"><span>Liegt auf (Verwahrung)</span><input name="loc" value="${esc((s.coins[sym] || {}).location || '')}" placeholder="${esc(x.location || 'z. B. Ledger')}"></label>
      <button class="btn line block" data-act="save">Speichern</button>
      <button class="btn gold block" data-act="add">＋ Transaktion für ${esc(sym)}</button>
      <button class="btn danger block" data-act="hide">Coin ausblenden (Demo, Scam, Staub)</button>
      <div class="small mut center">Ausgeblendete Coins zählen nirgends mit – nicht im Vermögen, nicht in der Steuer. Rückgängig unter Vault › Einstellungen.</div>`;
    },
    bind: (el) => el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tx]'); if (t) return openTx(S().transactions.find((q) => q.id === t.dataset.tx));
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'loadhist') { if (!navigator.onLine) return toast('Offline'); b.disabled = true; b.textContent = 'Lade Kursverlauf …'; loadHistory([sym]).then(() => rerender()); return; }
      if (b.dataset.act === 'add') openTx(null, sym);
      if (b.dataset.act === 'estimate') openEstimate();
      if (b.dataset.act === 'hide' && confirm(`${sym} ausblenden? Er zählt dann nirgends mehr mit (Vermögen, Steuer, Zuordnen). Die Buchungen bleiben gespeichert.`)) {
        const st = S().settings; st.ignoredAssets = [...new Set([...(st.ignoredAssets || []), sym])];
        closeSheet();
        // Meilensteine, die nur dank dieses Coins erreicht waren, zum Zurücksetzen anbieten
        const nw2 = netWorth({ verifiedOnly: true });
        const hit = S().goals.map((g) => [g, staleMilestones(g, nw2)]).filter(([, l]) => l.length);
        if (hit.length && confirm(`Ohne ${sym} liegen ${hit.reduce((a, [, l]) => a + l.length, 0)} erreichte Meilensteine über deinem Wert:\n${hit.map(([g, l]) => `${g.name}: ${l.map((m) => fmtGoal(m, g.unit)).join(', ')}`).join('\n')}\n\nZurücksetzen?`)) hit.forEach(([g, l]) => resetMilestones(g, l));
        commit(); toast(`${sym} ausgeblendet`);
      }
      if (b.dataset.act === 'save') {
        const s = S(); s.coins[sym] = { ...(s.coins[sym] || {}), id: el.querySelector('[name=cgid]').value.trim(), location: el.querySelector('[name=loc]').value.trim(), auto: false };
        commit(); toast('Gespeichert'); dispatchEvent(new Event('refreshprices'));
      }
    }),
  });
}

// ---------- Transaktion erfassen / bearbeiten ----------
const toNum = (x) => { x = String(x ?? '').trim(); if (x === '') return null; const n = Number(x.replace(/['’\s]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
export function openTx(tx = null, sym = '') {
  const d = tx ? { ...tx } : { type: 'buy', asset: sym, amount: '', chf: '', fee: 0, feeQty: '', platform: '', date: new Date().toISOString(), note: '', to: '' };
  const localISO = (iso) => { const t = new Date(iso); return isNaN(t) ? '' : new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  const showFor = (el, type) => { el.querySelectorAll('[data-only]').forEach((x) => { x.hidden = !x.dataset.only.split(' ').includes(type); }); };
  openSheet({
    title: tx ? (tx.type === 'review' ? 'Bitte zuordnen' : 'Transaktion') : 'Neue Transaktion',
    render: () => `
      ${d.type === 'review' ? `<div class="note amber"><b>Nicht eindeutig.</b> Lieber einmal fragen als falsch rechnen.<div class="small mt">${esc(d.raw || '')}</div><div class="small">${esc(d.note || '')}</div>${d.suggest ? `<div class="small">Betrag laut Export: ${esc(d.suggest)}</div>` : ''}</div>` : ''}
      ${d.note && d.type !== 'review' ? `<div class="small mut">${esc(d.note)}</div>` : ''}
      <div class="lbl mt">Was ist das?</div>
      ${chips('type', Object.entries(TYPES).filter(([k]) => k !== 'review').map(([k, v]) => [k, v.l]), d.type === 'review' ? '' : d.type)}
      <div class="small mut" data-hint></div>
      <div class="grid2">
        <label class="field"><span>Coin</span><input name="asset" value="${esc(d.asset)}" autocapitalize="characters" autocomplete="off" placeholder="BTC"></label>
        <label class="field"><span>Menge</span><input name="amount" inputmode="decimal" value="${esc(d.amount)}"></label>
        <label class="field" data-only="buy sell opening reward fee"><span>Gesamt in CHF</span><input name="chf" inputmode="decimal" value="${esc(d.type === 'transfer' ? '' : d.chf ?? '')}" placeholder="leer = unbekannt"></label>
        <label class="field" data-only="buy sell transfer"><span>Gebühr CHF</span><input name="fee" inputmode="decimal" value="${esc(d.fee || '')}"></label>
        <label class="field span2"><span>Datum</span><input name="date" type="datetime-local" value="${esc(localISO(d.date))}"></label>
        <label class="field"><span>Plattform</span><input name="platform" value="${esc(d.platform)}" placeholder="BingX, Relai"></label>
      </div>
      <div class="grid2" data-only="transfer">
        <label class="field"><span>Transfer nach</span><input name="to" value="${esc(d.to || '')}" placeholder="z. B. Ledger"></label>
        <label class="field"><span>Netzwerkgebühr in Coins</span><input name="feeQty" inputmode="decimal" value="${esc(d.feeQty || '')}" placeholder="optional"></label>
      </div>
      <button class="btn gold block big mt" data-act="save">Speichern</button>
      ${tx ? '<button class="btn danger block" data-act="del">Löschen</button>' : ''}`,
    bind: (el) => {
      const HINT = {
        buy: 'Kauf: erhöht Bestand und Kostenbasis (inkl. Gebühr). Ohne CHF-Betrag wird kein Ø-Preis berechnet.',
        sell: 'Verkauf: bucht zum Ø-Preis aus, Differenz = realisierter Gewinn/Verlust.',
        transfer: 'Transfer zwischen eigenen Konten: Bestand und Ø-Preis bleiben gleich (nur die Netzwerkgebühr verlässt den Bestand).',
        reward: 'Reward/Rebate: Kostenbasis CHF 0, falls kein Betrag angegeben.',
        ignore: 'Nicht relevant: zählt nirgends mit (Demo-Guthaben, Scam-Airdrop, Staub). Ganzen Coin ausblenden: im Coin-Detail.',
        fee: 'Gebühr in Coins: Bestand sinkt, Kostenbasis bleibt.',
        opening: 'Anfangsbestand: ohne CHF-Betrag bleibt der Ø-Preis offen. Mit Kaufbetrag wird er vollständig.',
      };
      const upd = (type) => { showFor(el, type || 'none'); el.querySelector('[data-hint]').textContent = HINT[type] || 'Bitte oben wählen, was diese Buchung ist.'; };
      upd(chipVal(el, 'type'));
      bindChips(el, 'type', upd);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const s = S();
        if (b.dataset.act === 'del') { if (confirm('Transaktion löschen?' + (tx.extId ? ' Sie wird auch bei einem erneuten Import nicht wieder angelegt.' : ''))) { deleteTx(tx.id); commit(); closeSheet(); } return; }
        const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
        const type = chipVal(el, 'type'); if (!type) return toast('Bitte zuerst oben wählen, was das ist');
        const amount = toNum(v('amount')); const chfV = toNum(v('chf')); const fee = toNum(v('fee')); const feeQty = toNum(v('feeQty'));
        const date = new Date(v('date'));
        const asset = v('asset').toUpperCase().replace(/\s+/g, '');
        if (!asset || !/^[A-Z0-9.\-_]{1,20}$/.test(asset)) return toast('Coin-Kürzel angeben (z. B. BTC)');
        if (!(amount > 0)) return toast('Menge muss grösser als 0 sein');
        if (Number.isNaN(chfV) || (chfV != null && chfV < 0)) return toast('CHF-Betrag ungültig');
        if (Number.isNaN(fee) || (fee != null && fee < 0) || Number.isNaN(feeQty) || (feeQty != null && feeQty < 0)) return toast('Gebühr ungültig');
        if (isNaN(date)) return toast('Datum ungültig');
        const o = { type, asset, amount, chf: chfV, fee: fee || 0, date: date.toISOString(), platform: v('platform'), to: '', feeQty: 0 };
        if (type === 'transfer') { o.chf = 0; o.to = v('to'); o.feeQty = feeQty || 0; if (o.feeQty >= amount) return toast('Gebühr grösser als Menge?'); }
        if (type === 'reward' && o.chf == null) o.chf = 0;
        if (type === 'fee') o.fee = 0;
        if (tx) { const live = s.transactions.find((q) => q.id === tx.id); if (live) { if (live.estimate && o.chf !== live.chf) delete live.estimate; Object.assign(live, o, { decided: true }); delete live.raw; delete live.suggest; } }
        else s.transactions.push({ id: uid(), extId: '', note: '', ...o });
        commit(); toast('Gespeichert'); closeSheet();
      });
    },
  });
}

// ---------- Konto ----------
export function openAccount(a = null) {
  const d = a ? { ...a } : { name: '', kind: 'bank', value: '', tag: '' };
  openSheet({
    title: a ? a.name : 'Neues Konto',
    render: () => `
      <label class="field"><span>Name</span><input name="name" value="${esc(d.name)}" placeholder="z. B. Raiffeisen Privat"></label>
      <div class="lbl">Art</div>${chips('kind', Object.entries(ACCOUNT_KINDS).map(([k, v]) => [k, v.l]), d.kind)}
      <label class="field"><span>Aktueller Stand CHF${(d.positions || []).length ? ' (automatisch aus Positionen)' : ''}</span><input name="value" inputmode="decimal" value="${esc(d.value)}"></label>
      <div data-only-kind="securities" ${d.kind === 'securities' ? '' : 'hidden'}>
        <label class="field"><span>Positionen (optional) – Ticker und Stückzahl, z. B. VWRL.SW 12; NESN.SW 5</span><input name="pos" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc((d.positions || []).map((p) => p.ticker + ' ' + p.qty).join('; '))}" placeholder="VWRL.SW 12; CHSPI.SW 3"></label>
        <div class="small mut">Mit Positionen bewertet dein Server das Depot täglich automatisch (Kurse von Yahoo Finance, Ticker wie dort, Schweizer Börse mit «.SW»). VIAC- oder Fonds-Portfolios ohne Ticker bitte weiter von Hand nachführen.</div>
        ${(d.positions || []).map((p) => { const q = (S().stockPrices || {})[p.ticker]; return `<div class="txr"><span class="grow"><b>${esc(p.ticker)}</b><span class="small mut"> · ${esc(q ? q.name : 'noch kein Kurs')}</span></span><span class="small mut">${qty(p.qty)} ×</span><b>${q ? chf(p.qty * q.chf) : '–'}</b></div>`; }).join('')}
      </div>
      <label class="check"><input type="checkbox" name="ng" ${d.tag === 'notgroschen' ? 'checked' : ''}> Das ist mein Notgroschen</label>
      ${a && a.history && a.history.length ? `<div class="lbl mt">Verlauf</div>${a.history.slice(-6).reverse().map((h) => `<div class="txr"><span class="grow small mut">${dmy(h.at)}</span><b>${chf(h.value)}</b></div>`).join('')}` : ''}
      <button class="btn gold block big mt" data-act="save">Speichern</button>
      ${a ? '<button class="btn danger block" data-act="del">Löschen</button>' : ''}`,
    bind: (el) => { bindChips(el, 'kind', (k) => { el.querySelector('[data-only-kind]').hidden = k !== 'securities'; }); el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const s = S();
      if (b.dataset.act === 'del') { if (confirm('Konto löschen?')) { s.accounts = s.accounts.filter((q) => q.id !== a.id); s.goals = s.goals.filter((g) => !(g.kind === 'account' && g.accountId === a.id)); commit(); closeSheet(); } return; }
      const name = el.querySelector('[name=name]').value.trim(); if (!name) return toast('Name fehlt');
      const value = toNum(el.querySelector('[name=value]').value) ?? 0;
      if (Number.isNaN(value)) return toast('Betrag ungültig');
      const o = { name, kind: chipVal(el, 'kind') || 'bank', value, tag: el.querySelector('[name=ng]').checked ? 'notgroschen' : '' };
      const rawPos = el.querySelector('[name=pos]').value.trim(); const positions = [];
      if (o.kind === 'securities' && rawPos) {
        for (const part of rawPos.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)) {
          const m = /^([A-Za-z0-9.\-^=]{1,20})\s+([\d'’.,]+)$/.exec(part);
          if (!m || !(toNum(m[2]) > 0)) return toast(`Position «${part}» nicht verstanden – Format: TICKER Stückzahl`);
          positions.push({ ticker: m[1].toUpperCase(), qty: toNum(m[2]) });
        }
      }
      o.positions = positions;
      if (a) {
        if (a.value !== value) { a.history = [...(a.history || []), { at: a.updated, value: a.value }]; a.updated = new Date().toISOString(); }
        Object.assign(a, o);
      } else s.accounts.push({ id: uid(), ...o, updated: new Date().toISOString(), history: [] });
      if (o.tag === 'notgroschen' && !s.goals.some((g) => g.kind === 'account')) {
        const acc = s.accounts.find((q) => q.tag === 'notgroschen'); if (acc)
        s.goals.push({ id: uid(), name: 'Notgroschen', kind: 'account', accountId: acc.id, unit: 'CHF', color: 'green', milestones: [7000], reached: {} });
      }
      commit(); toast('Gespeichert'); closeSheet();
      if (positions.length) dispatchEvent(new Event('serversync'));
    }); },
  });
}

// =====================================================================
// ZIELE
// =====================================================================
export function goals() {
  const s = S(); const nw = netWorth();
  return {
    title: 'Ziele', sub: 'Deine langfristigen Meilensteine',
    html: s.goals.map((g) => {
      const p = goalProgress(g, nw);
      return `<div class="card clickable ${p.done ? 'goldb' : ''}" data-goal="${g.id}">
        <div class="row">${progress(p.pct, GOAL_COLOR[g.color] || SLOTS[0], 60)}<div class="grow"><div class="lbl">${esc(g.name)}</div>
        <div class="big2">${fmtGoal(p.value, g.unit)}</div><span class="small mut">${p.done ? 'alle erreicht' : 'Ziel ' + fmtGoal(p.next, g.unit)}</span></div></div>
        ${staleMilestones(g).length ? `<div class="small amber">${staleMilestones(g).length} erreicht, aber aktuell darunter – prüfen</div>` : ''}
        <div class="small mut mt">${p.reachedCount} von ${p.total} Meilensteinen erreicht</div></div>`;
    }).join('') + `<button class="btn gold block mt" data-act="add">＋ Ziel hinzufügen</button>
      <div class="small mut mt">Konfetti gibt es nur beim ersten Erreichen eines Meilensteins. Keine Streaks, kein Druck.</div>`,
    bind: (el) => el.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goal]'); if (g) return openGoal(S().goals.find((q) => q.id === g.dataset.goal));
      if (e.target.closest('[data-act=add]')) openGoal();
    }),
  };
}

export function openGoal(goal = null) {
  const s = S();
  const d = goal ? { ...goal, milestones: [...goal.milestones] } : { name: '', kind: 'networth', unit: 'CHF', color: 'gold', milestones: [], reached: {}, asset: 'BTC' };
  openSheet({
    title: goal ? goal.name : 'Neues Ziel',
    render: () => {
      const nw = netWorth(); const ms = [...d.milestones].sort((a, b) => a - b);
      const p = goal ? goalProgress(goal, nw) : null;
      return `
      ${goal && staleMilestones(goal).length ? `<div class="note amber"><b>${staleMilestones(goal).length} erreichte${staleMilestones(goal).length > 1 ? '' : 'r'} Meilenstein${staleMilestones(goal).length > 1 ? 'e liegen' : ' liegt'} über deinem aktuellen Wert.</b> Wenn ein Kursrückgang der Grund ist, ist das normal. Wurde er nur durch falsche Daten erreicht (z. B. Scam-Coin), setz ihn zurück.
        <button class="btn line sm mt" data-act="resetstale">Zurücksetzen: ${staleMilestones(goal).map((m) => fmtGoal(m, d.unit)).join(', ')}</button></div>` : ''}
      ${goal ? `<div class="lbl">Meilenstein-Kette</div><div class="card chain">${ms.map((m) => `<div class="mrow ${goal.reached[m] ? 'done clickable' : m === p.next ? 'next' : ''}" ${goal.reached[m] ? `data-ms="${m}"` : ''}>
        <span class="mdot">${goal.reached[m] ? '✓' : ''}</span><b class="grow">${fmtGoal(m, d.unit)}</b>
        <span class="small ${goal.reached[m] ? 'pos' : 'mut'}">${goal.reached[m] ? 'erreicht ' + dmy(goal.reached[m]) : m === p.next ? 'nächstes Ziel' : ''}</span></div>`).join('')}</div>
        <div class="small mut">Aktuell: ${fmtGoal(p.value, d.unit)} · Tipp auf einen erreichten Meilenstein, um ihn abzuwählen.</div>` : ''}
      <label class="field"><span>Name</span><input name="name" value="${esc(d.name)}"></label>
      <div class="lbl">Was wird gemessen?</div>
      ${chips('kind', [['networth', 'Gesamtvermögen'], ['crypto', 'Crypto total'], ['asset', 'Coin-Menge'], ['category', 'Kategorie'], ['account', 'Konto']], d.kind)}
      <div class="grid2">
        <label class="field"><span>Coin (bei Coin-Menge)</span><input name="asset" value="${esc(d.asset || '')}" autocapitalize="characters"></label>
        <label class="field"><span>Kategorie / Konto</span><select name="ref">
          <option value="pillar3a" ${d.category === 'pillar3a' ? 'selected' : ''}>Säule 3a</option>
          <option value="securities" ${d.category === 'securities' ? 'selected' : ''}>Wertschriften</option>
          <option value="cash" ${d.category === 'cash' ? 'selected' : ''}>Cash</option>
          ${s.accounts.map((a) => `<option value="acc:${a.id}" ${d.accountId === a.id ? 'selected' : ''}>Konto: ${esc(a.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Meilensteine (mit Komma getrennt)</span><input name="ms" value="${esc(ms.join(', '))}" placeholder="25000, 50000, 100000"></label>
      <div class="lbl">Farbe</div>${chips('color', [['gold', 'Gold'], ['orange', 'Orange'], ['green', 'Grün'], ['teal', 'Türkis'], ['blue', 'Blau'], ['purple', 'Violett']], d.color)}
      <button class="btn gold block big mt" data-act="save">Speichern</button>
      ${goal ? '<button class="btn danger block" data-act="del">Ziel löschen</button>' : ''}`;
    },
    bind: (el) => el.addEventListener('click', (e) => {
      const mr = e.target.closest('[data-ms]');
      if (mr && goal) {
        const m = +mr.dataset.ms;
        if (confirm(`Meilenstein ${fmtGoal(m, d.unit)} als NICHT erreicht markieren? Er wird wieder gefeiert, sobald du ihn echt erreichst.`)) { resetMilestones(goal, [m]); commit(); rerender(); toast('Meilenstein zurückgesetzt'); }
        return;
      }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'resetstale') {
        const st = staleMilestones(goal);
        if (st.length && confirm(`${st.length} Meilenstein${st.length > 1 ? 'e' : ''} zurücksetzen?`)) { resetMilestones(goal, st); commit(); rerender(); toast('Zurückgesetzt'); }
        return;
      }
      if (b.dataset.act === 'del') { if (confirm('Ziel löschen?')) { s.goals = s.goals.filter((q) => q.id !== goal.id); commit(); closeSheet(); } return; }
      const kind = chipVal(el, 'kind') || 'networth';
      const ref = el.querySelector('[name=ref]').value;
      const asset = el.querySelector('[name=asset]').value.trim().toUpperCase();
      const ms = el.querySelector('[name=ms]').value.split(/[,;\s]+/).map((x) => Number(x.replace(/['’]/g, ''))).filter((x) => x > 0);
      if (!ms.length) return toast('Mindestens einen Meilenstein angeben');
      const o = {
        name: el.querySelector('[name=name]').value.trim() || 'Ziel', kind, color: chipVal(el, 'color') || 'gold', milestones: [...new Set(ms)].sort((a, b) => a - b),
        unit: kind === 'asset' ? asset || 'BTC' : 'CHF', asset: kind === 'asset' ? asset || 'BTC' : undefined,
        category: kind === 'category' && !ref.startsWith('acc:') ? ref : undefined,
        accountId: kind === 'account' && ref.startsWith('acc:') ? ref.slice(4) : undefined,
      };
      if (o.kind === 'account' && !o.accountId) return toast('Bitte ein Konto wählen');
      if (goal) { Object.assign(goal, o); for (const k of Object.keys(goal.reached)) if (!o.milestones.includes(+k)) delete goal.reached[k]; }
      else s.goals.push({ id: uid(), reached: {}, ...o });
      commit(); toast('Gespeichert'); closeSheet();
    }),
  });
}

// ---------- Meilenstein-Feier ----------
export function celebrate(list) {
  if (!list.length) return;
  const { goal, value } = list[list.length - 1];
  confetti();
  openSheet({
    title: 'Meilenstein',
    render: () => {
      const ms = [...goal.milestones].sort((a, b) => a - b); const p = goalProgress(goal, netWorth());
      return `<div class="celebrate"><div class="badge">✓</div><div class="lbl gold center">Meilenstein erreicht</div>
        <div class="serif huge center">${fmtGoal(value, goal.unit)}</div><div class="small mut center">${esc(goal.name)} · erreicht am ${dmy(new Date())}</div></div>
        ${list.length > 1 ? `<div class="note">Gleich ${list.length} Meilensteine auf einmal geknackt!</div>` : ''}
        <div class="lbl mt">Deine Meilenstein-Kette</div><div class="card chain">${ms.map((m) => `<div class="mrow ${goal.reached[m] ? 'done' : m === p.next ? 'next' : ''}"><span class="mdot">${goal.reached[m] ? '✓' : ''}</span><b class="grow">${fmtGoal(m, goal.unit)}</b>
          ${m === value ? '<span class="tag gold">NEU</span>' : m === p.next ? '<span class="small gold2">nächstes Ziel</span>' : ''}</div>`).join('')}</div>
        <button class="btn gold block big mt" data-act="ok">Weiter zum nächsten Ziel</button>`;
    },
    bind: (el) => el.querySelector('[data-act=ok]').addEventListener('click', closeSheet),
  });
}
