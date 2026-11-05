// =====================================================================
// views-main.js – Übersicht, Invest, Coin-Detail, Konten, Ziele
// =====================================================================
import { S, commit, uid } from './store.js';
import { TYPES, ACCOUNT_KINDS, portfolio, netWorth, holdings, goalProgress, reviewCount } from './calc.js';
import { coinId } from './prices.js';
import {
  esc, chf, qty, price, pct, cls, dmy, dmyShort, hm, ago, daysUntil, greeting, longDate, bar, icon,
  openSheet, closeSheet, toast, chips, chipVal, confetti,
} from './ui.js';

export const ui = { investTab: 'crypto' };
export const TAX_TOTAL = 10;

const fmtGoal = (v, unit) => (unit === 'CHF' ? chf(v) : `${qty(v)} ${unit}`);
export function openInvoicesSummary() {
  const open = S().invoices.filter((i) => i.status === 'open');
  return { open, sum: open.reduce((a, i) => a + (+i.amount || 0), 0), over: open.filter((i) => i.due && daysUntil(i.due) < 0).length };
}
const avgCell = (x) => (x.avg != null ? `<span class="mut">${price(x.avg)}</span>` : x.avgKnown != null ? `<span class="amber">≈ ${price(x.avgKnown)}</span>` : '<span class="amber">fehlt</span>');

// =====================================================================
// ÜBERSICHT
// =====================================================================
export function dashboard() {
  const s = S(); const nw = netWorth(); const rc = reviewCount();
  const segs = [['crypto', 'Crypto', 'gold'], ['pillar3a', 'Säule 3a', 'teal'], ['securities', 'ETF', 'blue'], ['cash', 'Cash', 'mut']];
  const tot = Math.max(1, nw.assets);
  const g1 = s.goals.find((g) => g.kind === 'networth');
  const g2 = s.goals.find((g) => g.kind === 'asset' && g.asset === 'BTC');
  const inv = openInvoicesSummary();
  const yr = new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();
  const ck = (s.taxYears[yr] || {}).checklist || {};
  const taxDone = Object.values(ck).filter(Boolean).length;
  const live = s.pricesAt && Date.now() - new Date(s.pricesAt) < 15 * 60e3;
  const missing = nw.pf.held.filter((x) => x.quality === 'missing').length;
  const goalCard = (g, color) => {
    if (!g) return '';
    const p = goalProgress(g, nw);
    return `<div class="card clickable" data-go="#/ziele">
      <div class="lbl ${color}">${g.kind === 'networth' ? 'Nächster Meilenstein' : esc(g.name) + '-Ziel'}</div>
      <div class="row"><div class="serif big2 grow">${p.done ? 'Alle erreicht' : fmtGoal(p.next, g.unit)}</div><b class="gold2">${(p.pct * 100).toFixed(1)} %</b></div>
      ${bar(p.pct, color)}
      <div class="small mut">${p.done ? 'Neue Meilensteine unter Ziele hinzufügen' : `Aktuell ${fmtGoal(p.value, g.unit)} · noch ${fmtGoal(p.next - p.value, g.unit)}`}</div></div>`;
  };
  return {
    title: `${greeting()}, ${esc(s.settings.name)}`,
    sub: `${longDate()} <span class="live ${live ? 'on' : ''}">${live ? '● Kurse live · ' + hm(s.pricesAt) : s.pricesAt ? 'Kurse ' + dmyShort(s.pricesAt) + ' ' + hm(s.pricesAt) : 'Noch keine Kurse'}</span>`,
    html: `
    <div class="card hero">
      <div class="lbl">Gesamtvermögen</div>
      <div class="serif huge">${chf(nw.net)}</div>
      ${nw.pf.unrealPct != null ? `<div class="${cls(nw.pf.unreal)} b">Crypto ${chf(nw.pf.unreal, 0, true)} · ${pct(nw.pf.unrealPct)} unrealisiert</div>` : ''}
      <div class="stack">${segs.map(([k, , c]) => `<i class="${c}" style="width:${(nw[k] / tot) * 100}%"></i>`).join('')}</div>
      <div class="legend">${segs.map(([k, l, c]) => `<span><i class="dotc ${c}"></i>${l} ${((nw[k] / tot) * 100).toFixed(0)} %</span>`).join('')}</div>
      ${nw.liability ? `<div class="small mut">Verbindlichkeiten ${chf(-nw.liability)} bereits abgezogen</div>` : ''}
    </div>
    ${goalCard(g1, 'gold')}
    <div class="grid2">
      <div class="card clickable" data-go="#/rechnungen"><div class="lbl">Rechnungen</div><div class="serif big2">${chf(inv.sum)}</div>
        <div class="small ${inv.over ? 'neg' : inv.open.length ? 'amber' : 'pos'}">${inv.open.length ? `${inv.open.length} offen${inv.over ? ' · ' + inv.over + ' überfällig' : ''}` : 'Alles bezahlt'}</div></div>
      <div class="card clickable" data-go="#/steuern"><div class="lbl">Steuern ${yr}</div><div class="serif big2">${taxDone} / ${TAX_TOTAL}</div>
        ${bar(taxDone / TAX_TOTAL, 'green')}<div class="small mut">Checkliste</div></div>
    </div>
    ${rc ? `<div class="card clickable row" data-go="#/vault/pruefen">${icon('warn')}<div class="grow"><b>Finance Inbox</b><div class="small mut">${rc} Transaktion${rc > 1 ? 'en' : ''} bitte zuordnen</div></div><span class="gold">›</span></div>` : ''}
    ${missing ? `<div class="card clickable row" data-go="#/invest">${icon('warn')}<div class="grow"><b>Kaufhistorie unvollständig</b><div class="small mut">Bei ${missing} Coin${missing > 1 ? 's' : ''} fehlt ein Teil der Käufe. Ø-Preis wird nicht erfunden.</div></div><span class="gold">›</span></div>` : ''}
    ${goalCard(g2, 'orange')}
    ${!s.transactions.length && !s.accounts.length ? `<div class="card"><b>Los geht's</b><div class="small mut">Importiere deine BingX- und Relai-Exporte unter Vault, erfasse deine Konten unter Invest, oder lade Demo-Daten unter Vault › Einstellungen.</div>
      <div class="grid2 mt"><button class="btn gold" data-go="#/vault">Importieren</button><button class="btn line" data-go="#/invest">Konten</button></div></div>` : ''}`,
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
    body = `<div class="card hero"><div class="lbl">Crypto total</div><div class="row"><div class="serif huge grow">${chf(pf.total)}</div>
      <div class="right"><div class="b ${cls(pf.unreal)}">${chf(pf.unreal, 0, true)}</div><div class="small ${cls(pf.unreal)}">${pct(pf.unrealPct)}</div></div></div>
      <div class="small mut">Unrealisiert nur für Coins mit vollständiger Kaufhistorie · Realisiert ${chf(pf.realized, 0, true)}</div></div>
      <div class="thead"><span>Coin</span><span>Ø Kauf</span><span>Wert / P/L</span></div>
      ${pf.held.map((x) => `<div class="coin clickable" data-coin="${esc(x.asset)}">
        <div class="cic">${esc(x.asset[0])}</div><div class="grow"><b>${esc(x.asset)}</b><div class="small mut">${qty(x.qty)}</div></div>
        <div class="avg">${avgCell(x)}</div>
        <div class="right"><b>${x.value != null ? chf(x.value) : '–'}</b><div class="small ${x.quality === 'missing' ? 'amber' : cls(x.unrealPct)}">${x.quality === 'missing' ? 'Historie fehlt' : pct(x.unrealPct)}</div></div></div>`).join('')
        || '<div class="card mut">Noch keine Crypto-Transaktionen. Importiere sie unter Vault.</div>'}
      ${done.length ? `<div class="lbl mt">Komplett verkauft</div>${done.map((x) => `<div class="coin clickable" data-coin="${esc(x.asset)}"><div class="cic">${esc(x.asset[0])}</div><b class="grow">${esc(x.asset)}</b><div class="right ${x.realizedUnknown ? 'amber' : cls(x.realized)}">${x.realizedUnknown ? 'Gewinn unbekannt' : chf(x.realized, 0, true)}</div></div>`).join('')}` : ''}
      <div class="small mut mt">≈ = Ø-Preis nur des Teils mit bekannter Kaufhistorie.</div>
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
    bind: (el) => el.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tab]'); if (tb) { ui.investTab = tb.dataset.tab; dispatchEvent(new Event('rerender')); return; }
      const c = e.target.closest('[data-coin]'); if (c) return openCoin(c.dataset.coin);
      const a = e.target.closest('[data-acc]'); if (a) return openAccount(S().accounts.find((x) => x.id === a.dataset.acc));
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'addacc') openAccount();
      if (b.dataset.act === 'addtx') openTx();
      if (b.dataset.act === 'refresh') dispatchEvent(new Event('refreshprices'));
    }),
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
      <div class="grid2">
        <div class="card"><div class="lbl">Ø Kaufpreis</div><div class="serif big2">${x.avg != null ? price(x.avg) : 'nicht verfügbar'}</div>
          ${x.avgKnown != null ? `<div class="small amber">≈ ${price(x.avgKnown)} für den bekannten Teil</div>` : ''}<div class="small mut">Investiert (bekannt)</div><b>${chf(x.cost)}</b></div>
        <div class="card"><div class="lbl">Unrealisiert</div><div class="serif big2 ${cls(x.unreal)}">${chf(x.unreal, 0, true)}</div><div class="small mut">Performance</div><b class="${cls(x.unrealPct)}">${pct(x.unrealPct)}</b></div>
      </div>
      <div class="card row"><div class="grow"><div class="small mut">Realisierter Gewinn</div><b class="${x.realizedUnknown ? 'amber' : cls(x.realized)}">${x.realizedUnknown ? 'teilweise unbekannt' : chf(x.realized, 2, true)}</b></div><div class="right"><div class="small mut">Gebühren</div><b>${chf(x.fees, 2)}</b></div></div>
      ${x.quality === 'missing' ? `<div class="note amber">Für einen Teil des Bestands fehlt die Kaufhistorie (Anfangsbestand ohne Preis). Importiere die ältere Handelshistorie oder trage den Kaufpreis im Anfangsbestand nach. Es wird kein Ø-Preis erfunden.</div>` : ''}
      <div class="lbl mt">Transaktionen (${txs.length})</div>
      ${txs.slice(0, 200).map((t) => `<div class="txr clickable" data-tx="${t.id}"><i class="dotc ${TYPES[t.type].c}"></i><div class="grow"><b>${TYPES[t.type].l}</b><div class="small mut">${dmyShort(t.date)} · ${esc(t.platform || '')}${t.to ? ' › ' + esc(t.to) : ''}</div></div>
        <div class="right"><b>${t.type === 'sell' || t.type === 'fee' ? '-' : t.type === 'transfer' ? '' : '+'}${qty(t.amount)}</b><div class="small mut">${t.type === 'transfer' ? 'kein Kauf' : t.type === 'reward' ? 'Kosten 0' : t.chf != null ? chf(t.chf, 2) : 'CHF fehlt'}</div></div></div>`).join('')}
      <div class="lbl mt">Einstellungen</div>
      <label class="field"><span>CoinGecko-ID (für Kurse)</span><input name="cgid" value="${esc(coinId(sym) || '')}" placeholder="z. B. kaspa"></label>
      <label class="field"><span>Liegt auf (Verwahrung)</span><input name="loc" value="${esc((s.coins[sym] || {}).location || '')}" placeholder="${esc(x.location || 'z. B. Ledger')}"></label>
      <button class="btn line block" data-act="save">Speichern</button>
      <button class="btn gold block" data-act="add">＋ Transaktion für ${esc(sym)}</button>`;
    },
    bind: (el) => el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tx]'); if (t) return openTx(S().transactions.find((q) => q.id === t.dataset.tx));
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'add') openTx(null, sym);
      if (b.dataset.act === 'save') {
        const s = S(); s.coins[sym] = { ...(s.coins[sym] || {}), id: el.querySelector('[name=cgid]').value.trim(), location: el.querySelector('[name=loc]').value.trim() };
        commit(); toast('Gespeichert'); dispatchEvent(new Event('refreshprices'));
      }
    }),
  });
}

// ---------- Transaktion erfassen / bearbeiten ----------
export function openTx(tx = null, sym = '') {
  const d = tx ? { ...tx } : { type: 'buy', asset: sym, amount: '', chf: '', fee: 0, platform: '', date: new Date().toISOString(), note: '', to: '' };
  const localISO = (iso) => new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  openSheet({
    title: tx ? (tx.type === 'review' ? 'Bitte zuordnen' : 'Transaktion') : 'Neue Transaktion',
    render: () => `
      ${d.type === 'review' ? `<div class="note amber"><b>Nicht eindeutig.</b> Lieber einmal fragen als falsch rechnen.<div class="small mt">${esc(d.raw || '')}</div><div class="small">${esc(d.note || '')}</div></div>` : ''}
      ${d.note && d.type !== 'review' ? `<div class="small mut">${esc(d.note)}</div>` : ''}
      <div class="lbl mt">Was ist das?</div>
      ${chips('type', Object.entries(TYPES).filter(([k]) => k !== 'review').map(([k, v]) => [k, v.l]), d.type === 'review' ? '' : d.type)}
      <div class="grid2">
        <label class="field"><span>Coin</span><input name="asset" value="${esc(d.asset)}" autocapitalize="characters" placeholder="BTC"></label>
        <label class="field"><span>Menge</span><input name="amount" inputmode="decimal" value="${esc(d.amount)}"></label>
        <label class="field"><span>Gesamt in CHF</span><input name="chf" inputmode="decimal" value="${esc(d.chf ?? '')}" placeholder="leer = unbekannt"></label>
        <label class="field"><span>Gebühr CHF</span><input name="fee" inputmode="decimal" value="${esc(d.fee || '')}"></label>
        <label class="field"><span>Datum</span><input name="date" type="datetime-local" value="${esc(localISO(d.date))}"></label>
        <label class="field"><span>Plattform</span><input name="platform" value="${esc(d.platform)}" placeholder="BingX, Relai"></label>
      </div>
      <label class="field"><span>Transfer nach (nur bei Transfer)</span><input name="to" value="${esc(d.to || '')}" placeholder="z. B. Ledger"></label>
      <div class="small mut">Transfer: Bestand und Ø-Preis bleiben gleich. Reward: Kostenbasis CHF 0. Anfangsbestand ohne CHF: Ø-Preis wird nicht berechnet. Trägst du beim Anfangsbestand den Kaufbetrag ein, wird der Ø-Preis vollständig.</div>
      <button class="btn gold block big mt" data-act="save">Speichern</button>
      ${tx ? '<button class="btn danger block" data-act="del">Löschen</button>' : ''}`,
    bind: (el) => el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const s = S();
      if (b.dataset.act === 'del') { if (confirm('Transaktion löschen?')) { s.transactions = s.transactions.filter((q) => q.id !== tx.id); commit(); closeSheet(); } return; }
      const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
      const type = chipVal(el, 'type'); if (!type) return toast('Bitte Typ wählen');
      const n = (x) => (x === '' ? null : Number(x.replace(/['’]/g, '').replace(',', '.')));
      const o = { type, asset: v('asset').toUpperCase(), amount: n(v('amount')), chf: n(v('chf')), fee: n(v('fee')) || 0, date: new Date(v('date')).toISOString(), platform: v('platform'), to: v('to') };
      if (!o.asset || !o.amount) return toast('Coin und Menge angeben');
      if (type === 'transfer') o.chf = 0;
      if (type === 'reward' && o.chf == null) o.chf = 0;
      if (tx) { Object.assign(tx, o, { decided: true }); delete tx.raw; } else s.transactions.push({ id: uid(), extId: '', note: '', ...o });
      commit(); toast('Gespeichert'); closeSheet();
    }),
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
      <label class="field"><span>Aktueller Stand CHF</span><input name="value" inputmode="decimal" value="${esc(d.value)}"></label>
      <label class="check"><input type="checkbox" name="ng" ${d.tag === 'notgroschen' ? 'checked' : ''}> Das ist mein Notgroschen</label>
      ${a && a.history && a.history.length ? `<div class="lbl mt">Verlauf</div>${a.history.slice(-6).reverse().map((h) => `<div class="txr"><span class="grow small mut">${dmy(h.at)}</span><b>${chf(h.value)}</b></div>`).join('')}` : ''}
      <button class="btn gold block big mt" data-act="save">Speichern</button>
      ${a ? '<button class="btn danger block" data-act="del">Löschen</button>' : ''}`,
    bind: (el) => el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const s = S();
      if (b.dataset.act === 'del') { if (confirm('Konto löschen?')) { s.accounts = s.accounts.filter((q) => q.id !== a.id); commit(); closeSheet(); } return; }
      const name = el.querySelector('[name=name]').value.trim(); if (!name) return toast('Name fehlt');
      const value = Number(el.querySelector('[name=value]').value.replace(/['’]/g, '').replace(',', '.')) || 0;
      const o = { name, kind: chipVal(el, 'kind') || 'bank', value, tag: el.querySelector('[name=ng]').checked ? 'notgroschen' : '' };
      if (a) {
        if (a.value !== value) { a.history = [...(a.history || []), { at: a.updated, value: a.value }]; a.updated = new Date().toISOString(); }
        Object.assign(a, o);
      } else s.accounts.push({ id: uid(), ...o, updated: new Date().toISOString(), history: [] });
      if (o.tag === 'notgroschen' && !s.goals.some((g) => g.kind === 'account')) {
        const acc = s.accounts.find((q) => q.tag === 'notgroschen');
        s.goals.push({ id: uid(), name: 'Notgroschen', kind: 'account', accountId: acc.id, unit: 'CHF', color: 'green', milestones: [7000], reached: {} });
      }
      commit(); toast('Gespeichert'); closeSheet();
    }),
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
        <div class="lbl ${g.color}">${esc(g.name)}</div>
        <div class="row"><div class="serif big2 grow">${fmtGoal(p.value, g.unit)}</div><span class="small mut">${p.done ? 'alle erreicht' : 'Ziel ' + fmtGoal(p.next, g.unit)}</span></div>
        ${bar(p.pct, g.color)}
        <div class="row small"><span class="grow mut">${p.reachedCount} von ${p.total} Meilensteinen</span><b class="${g.color}">${(p.pct * 100).toFixed(0)} %</b></div></div>`;
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
      ${goal ? `<div class="lbl">Meilenstein-Kette</div><div class="card chain">${ms.map((m) => `<div class="mrow ${goal.reached[m] ? 'done' : m === p.next ? 'next' : ''}">
        <span class="mdot">${goal.reached[m] ? '✓' : ''}</span><b class="grow">${fmtGoal(m, d.unit)}</b>
        <span class="small ${goal.reached[m] ? 'pos' : 'mut'}">${goal.reached[m] ? 'erreicht ' + dmy(goal.reached[m]) : m === p.next ? 'nächstes Ziel' : ''}</span></div>`).join('')}</div>
        <div class="small mut">Aktuell: ${fmtGoal(p.value, d.unit)}</div>` : ''}
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
      const b = e.target.closest('[data-act]'); if (!b) return;
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
