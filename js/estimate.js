// =====================================================================
// estimate.js – Fehlende Kaufpreise schätzen (nur auf Wunsch, immer markiert)
//
// Ausgangslage: Ein Kontoauszug enthält nicht alle Trades (z. B. BingX zeigt
// ältere Spot-Käufe oder «Convert»-Käufe nicht). Der Saldo-Abgleich erkennt dann:
//   · Coins tauchen auf, ohne Kauf  -> Anfangsbestand ohne Kaufpreis
//   · Stablecoins verschwinden, ohne Verkauf -> «Fehlende Abbuchung»
//
// Zwei Methoden – beide werden als «geschätzt» gekennzeichnet (≈ im Ø-Preis):
//   1. Tageskurs: Menge × CHF-Kurs am Tag, an dem der Coin im Auszug auftaucht.
//   2. Verteilen: Die tatsächlich verschwundenen Stablecoins (= echt bezahltes Geld)
//      werden im Verhältnis der Tageswerte auf die Coins verteilt. Die Summe
//      stimmt dann mit dem real ausgegebenen Betrag überein.
// Für die Schweizer Vermögenssteuer zählt nur der Bestand per 31.12. – der
// Kaufpreis dient nur der Performance-Anzeige.
// =====================================================================
import { S, commit } from './store.js';
import { historicalCHF, STABLE_USD } from './prices.js';
import { hiddenAssets } from './calc.js';
import { esc, chf, qty, dmy, openSheet, closeSheet, toast, rerender } from './ui.js';

const isMissing = (t) => t.type === 'opening' && (t.chf == null || t.chf === '');
export function missingOpenings() {
  const h = hiddenAssets();
  return S().transactions.filter((t) => isMissing(t) && !h.has(t.asset)).sort((a, b) => new Date(a.date) - new Date(b.date));
}
// Stablecoins, die laut Saldo verschwunden sind, ohne Gegenbuchung im Export
export function unmatchedStable() {
  return S().transactions.filter((t) => t.type === 'sell' && STABLE_USD.includes(t.asset) && String(t.extId || '').startsWith('bingx:gap|'));
}

export function openEstimate() {
  const st = { values: null, busy: false, stableChf: null };
  const list = () => missingOpenings();
  openSheet({
    title: 'Kaufpreise schätzen',
    render: () => {
      const L = list();
      if (!L.length) return '<div class="card">Keine fehlenden Kaufpreise 👍</div>';
      const v = st.values;
      const sumDay = v ? L.reduce((a, t) => a + (v[t.id] ?? 0), 0) : null;
      const missingV = v ? L.filter((t) => v[t.id] == null).length : 0;
      return `
        <div class="small mut">Für ${L.length} Buchung${L.length > 1 ? 'en' : ''} fehlt der Kaufpreis, weil der Kauf nicht im Export steht. Du kannst ihn schätzen lassen – das Ergebnis wird überall mit <b class="amber">≈ geschätzt</b> markiert und lässt sich jederzeit pro Transaktion korrigieren.</div>
        <div class="card mt">${L.map((t) => `<div class="txr"><b class="grow">${esc(t.asset)}<div class="small mut">${qty(t.amount)} · aufgetaucht ${dmy(t.date)}</div></b>
          <span class="small">${v ? (v[t.id] != null ? chf(v[t.id], 2) : '<span class="amber">kein Kurs</span>') : ''}</span></div>`).join('')}</div>
        ${!v ? `<button class="btn gold block big" data-act="load" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Lade historische Kurse …' : 'Historische Kurse laden'}</button><div class="small mut" data-prog></div>` : `
          <div class="card"><div class="row"><span class="grow small">Wert am Tag des Auftauchens</span><b>${chf(sumDay, 2)}</b></div>
            ${st.stableChf ? `<div class="row"><span class="grow small">Stablecoins ohne Gegenbuchung (echt bezahlt)</span><b>${chf(st.stableChf, 2)}</b></div>` : ''}
            ${missingV ? `<div class="small amber mt">${missingV} ohne Kurs bleiben offen.</div>` : ''}</div>
          <button class="btn gold block big" data-act="day">1 · Mit Tageskurs übernehmen</button>
          <div class="small mut">Kauf ungefähr zum Kurs des Tages, an dem der Coin im Auszug erscheint. Gut bei regelmässigen Käufen (Sparplan).</div>
          ${st.stableChf ? `<button class="btn line block mt" data-act="alloc">2 · Bezahlte ${chf(st.stableChf, 0)} verteilen</button>
          <div class="small mut">Die verschwundenen Stablecoins sind das Geld, das du tatsächlich bezahlt hast. Es wird im Verhältnis der Tageswerte auf die Coins verteilt. Passt nur, wenn alle diese Coins mit diesen Stablecoins gekauft wurden.</div>` : ''}`}
        <div class="small mut mt">Kennst du den echten Betrag (z. B. aus der BingX-Orderhistorie)? Dann die Transaktion im Coin öffnen und «Gesamt in CHF» eintragen – das ist immer besser als eine Schätzung.</div>`;
    },
    bind: (el) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const L = list();
      if (b.dataset.act === 'load') {
        if (!navigator.onLine) return toast('Offline – Kurse nicht erreichbar');
        st.busy = true; b.disabled = true; b.textContent = 'Lade historische Kurse …';
        const prog = el.querySelector('[data-prog]'); const values = {};
        for (let i = 0; i < L.length; i++) {
          prog.textContent = `${i + 1} / ${L.length} · ${L[i].asset}`;
          const r = await historicalCHF(L[i].asset, L[i].date).catch(() => null);
          values[L[i].id] = r != null ? +(r * L[i].amount).toFixed(2) : null;
        }
        let stable = 0;
        for (const t of unmatchedStable()) {
          let c = t.chf; if (c == null) { const r = await historicalCHF(t.asset, t.date).catch(() => null); c = r != null ? r * t.amount : null; }
          if (c != null) stable += +c;
        }
        st.values = values; st.stableChf = stable > 0 ? +stable.toFixed(2) : null; st.busy = false;
        return rerender();
      }
      if (b.dataset.act === 'day' || b.dataset.act === 'alloc') {
        const v = st.values; const ok = L.filter((t) => v[t.id] != null);
        const total = ok.reduce((a, t) => a + v[t.id], 0);
        if (!ok.length || total <= 0) return toast('Keine Kurse gefunden');
        const alloc = b.dataset.act === 'alloc';
        if (!confirm(alloc ? `${chf(st.stableChf, 2)} auf ${ok.length} Buchungen verteilen?` : `${ok.length} Kaufpreise mit dem Tageskurs schätzen?`)) return;
        const tx = S().transactions;
        for (const t of ok) {
          const live = tx.find((q) => q.id === t.id); if (!live) continue;
          live.chf = +(alloc ? st.stableChf * (v[t.id] / total) : v[t.id]).toFixed(2);
          live.estimate = alloc ? 'alloc' : 'day';
          live.decided = true; // bleibt bei einem erneuten Import erhalten
          live.note = (alloc ? 'Kaufpreis geschätzt: bezahlte Stablecoins verteilt' : 'Kaufpreis geschätzt: Tageskurs beim Auftauchen') + (live.note ? ' · ' + live.note : '');
        }
        commit(); toast(`${ok.length} Kaufpreise geschätzt`); closeSheet();
      }
    }),
  });
}
