// =====================================================================
// views-analyse.js – Finance Health, Vermögensanalyse, FI-Dashboard
// =====================================================================
import { commit } from './store.js';
import { esc, chf, pct, cls, icon, dmy, openSheet, closeSheet, toast } from './ui.js';
import { ring, area, progress, SLOTS } from './charts.js';
import * as H from './health.js';
import * as P from './perf.js';
import { verifyBackup, backupInfo } from './vault.js';

export const aui = { tab: 'health', range: 365 };
const TABS = [['health', 'Health'], ['vermoegen', 'Vermögen'], ['fi', 'FI']];

export function analyse(sub) {
  if (sub && TABS.some(([k]) => k === sub)) aui.tab = sub;
  const t = aui.tab;
  const tabs = `<div class="seg">${TABS.map(([k, l]) => `<button class="${t === k ? 'sel' : ''}" data-atab="${k}">${l}</button>`).join('')}</div>`;
  const body = t === 'health' ? healthHTML() : t === 'vermoegen' ? perfHTML() : fiHTML();
  return {
    title: 'Analyse', sub: t === 'health' ? 'Ist alles aktuell, gesichert und stimmig?' : t === 'vermoegen' ? 'Eigenes Geld vs. Marktentwicklung' : 'Finanzielle Unabhängigkeit',
    html: tabs + body,
    bind: (el) => {
      el.addEventListener('click', (e) => {
        const tb = e.target.closest('[data-atab]'); if (tb) { location.hash = '#/analyse/' + tb.dataset.atab; return; }
        const r = e.target.closest('[data-arange]'); if (r) { aui.range = +r.dataset.arange; dispatchEvent(new Event('rerender')); return; }
        const g = e.target.closest('[data-hgo]'); if (g) return healthGo(g.dataset.hgo);
        if (e.target.closest('[data-act=fiedit]')) return openFiSettings();
      });
      el.querySelector('[data-btest]')?.addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openBackupTest(await f.text()); });
    },
  };
}

// ---------- Health ----------
function healthHTML() {
  const list = H.checks(); const sc = H.score(list);
  const order = { bad: 0, warn: 1, ok: 2 };
  return `<div class="card hero ringwrap">${ring([{ label: 'erfüllt', value: sc, color: sc >= 80 ? SLOTS[2] : sc >= 50 ? SLOTS[0] : SLOTS[3] }, { label: 'offen', value: 100 - sc, color: '#3a3b40' }], { size: 190, thick: 10, center: { label: 'Finance Health', value: `${sc}`, sub: sc >= 80 ? 'sehr gut' : sc >= 50 ? 'einiges offen' : 'Handlungsbedarf' }, fmt: (v) => `${v} %` })}
    <div class="small mut center">${list.filter((c) => c.st !== 'ok').length} von ${list.length} Punkten brauchen Aufmerksamkeit</div></div>
  <div class="card">${[...list].sort((a, b) => order[a.st] - order[b.st]).map((c) => `<div class="txr clickable" data-hgo="${esc(c.go)}">${icon(c.st)}<div class="grow"><b>${esc(c.label)}</b><div class="small mut">${esc(c.detail)}</div></div><span class="chev">›</span></div>`).join('')}</div>
  <label class="btn line block">🧪 Backup testen (Datei wählen)<input type="file" accept=".json,application/json" data-btest hidden></label>
  <div class="small mut">Der Test öffnet ein Backup mit Backup-Passwort und PIN und entschlüsselt alle Daten und Dateien – ohne etwas zu verändern. So weisst du, dass es im Ernstfall funktioniert.</div>`;
}
function healthGo(go) {
  if (go === 'backup') { location.hash = '#/vault/einstellungen'; setTimeout(() => document.querySelector('[data-act=backup]')?.click(), 300); return; }
  if (go === 'backuptest') { document.querySelector('[data-btest]')?.click(); return; }
  if (go === 'refresh') { dispatchEvent(new Event('refreshprices')); return; }
  location.hash = go;
}
export function openBackupTest(text) {
  let info; try { info = backupInfo(text); } catch (e) { return toast(e.message); }
  openSheet({
    title: 'Backup testen',
    render: () => `<div class="small mut">Backup${info.exported ? ' vom ' + dmy(info.exported) : ''}. Es wird nichts überschrieben.</div>
      ${info.needsPassword ? '<label class="field mt"><span>Backup-Passwort</span><input name="bp" type="password" autocomplete="off"></label>' : '<div class="note amber">Älteres Backup ohne Backup-Passwort – bitte neues Backup erstellen.</div>'}
      <label class="field"><span>PIN des Backups</span><input name="pin" type="password" autocomplete="current-password"></label>
      <button class="btn gold block big mt" data-act="go">Test starten</button><div class="small" data-res></div>`,
    bind: (el) => el.querySelector('[data-act=go]').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Entschlüssele …';
      const m = H.meta();
      try {
        const r = await verifyBackup(text, { password: el.querySelector('[name=bp]')?.value || '', pin: el.querySelector('[name=pin]').value });
        m.lastBackupTest = { at: new Date().toISOString(), ok: true, tx: r.tx, files: r.files, exported: r.exported };
        commit(); toast('Backup-Test bestanden ✓', 4000); closeSheet();
      } catch (err) {
        m.lastBackupTest = { at: new Date().toISOString(), ok: false, error: err.message }; commit();
        el.querySelector('[data-res]').textContent = err.message; b.disabled = false; b.textContent = 'Nochmals versuchen';
      }
    }),
  });
}

// ---------- Vermögen: Einzahlungen vs. Performance ----------
function perfHTML() {
  const R = aui.range; const a = P.analysis(R);
  const label = R === 365 ? '12 Monate' : R === 90 ? '3 Monate' : '30 Tage';
  const row = (l, v, c = '') => `<div class="txr"><span class="grow">${l}</span><b class="${c}">${v}</b></div>`;
  return `<div class="card"><div class="row"><div class="lbl grow">Vermögen ${label}</div>
      <div class="seg mini">${[[30, '1M'], [90, '3M'], [365, '1J']].map(([d, l]) => `<button class="${R === d ? 'sel' : ''}" data-arange="${d}">${l}</button>`).join('')}</div></div>
    <div class="trend-h"><span class="${cls(a.gain)}">${chf(a.gain, 0, true)}</span><span class="small mut">Performance ${a.pct != null ? pct(a.pct) : ''}</span></div>
    ${area(a.pts, { color: SLOTS[0], fmt: (v) => chf(v), base: a.contrib, baseLabel: 'eingezahlt', label: 'Nettovermögen und Einzahlungen', height: 160 })}
    <div class="row small mt"><span><i class="lg-dot" style="display:inline-block;background:${SLOTS[0]}"></i> Nettovermögen</span><span><i class="lg-dot" style="display:inline-block;background:${SLOTS[1]}"></i> Startwert + Einzahlungen</span></div></div>
  <div class="card">${row('Startwert', chf(a.start))}${row('+ Einzahlungen / Sparen', chf(a.flows, 0, true))}${row('+ Marktentwicklung (Performance)', chf(a.gain, 0, true), cls(a.gain))}${row('= Heute', chf(a.end))}
    <div class="lbl mt">Einzahlungen nach Bereich</div>${row('Crypto (Käufe − Verkäufe)', chf(a.by.crypto, 0, true))}${row('Bank & Cash (Sparen)', chf(a.by.cash, 0, true))}${row('Wertschriften & 3a', chf(a.by.depot, 0, true))}
    ${a.unknown ? `<div class="small amber mt">${a.unknown} Buchung${a.unknown > 1 ? 'en' : ''} ohne Kaufpreis – Einzahlungen dadurch zu tief. Unter Invest schätzen lassen.</div>` : ''}
    <div class="small mut mt">Wertschriften/3a: Gib beim Aktualisieren des Kontos «davon Einzahlung» an, sonst zählt die ganze Veränderung als Performance. Bank & Cash zählen immer als Sparen. Rendite vereinfacht (Modified Dietz).</div></div>
  <div class="small mut center">${P.snapshotsCount()} Tages-Snapshots gespeichert · der Verlauf wird zusätzlich aus deinen Transaktionen und Kontoständen rekonstruiert</div>`;
}

// ---------- FI-Dashboard ----------
function fiHTML() {
  const f = P.fiCalc(); const c = f.cfg;
  const yrs = f.months != null ? f.months / 12 : null;
  const when = f.months != null ? new Date(Date.now() + f.months * 30.44 * 864e5) : null;
  return `<div class="card hero row">${progress(f.progress, SLOTS[2], 84)}<div class="grow"><div class="lbl">FI-Zahl</div><div class="big2">${chf(f.target)}</div>
      <div class="small mut">${c.expenses.toLocaleString('de-CH')} CHF/Monat ÷ ${c.swr} % Entnahme</div></div></div>
    <div class="grid2"><div class="card"><div class="lbl">Investiert</div><div class="big2">${chf(f.current)}</div><div class="small mut">${c.excludeNotgroschen ? 'ohne Notgroschen' : 'Nettovermögen'}</div></div>
      <div class="card"><div class="lbl">Ziel erreicht</div><div class="big2">${yrs != null ? (yrs < 1 ? 'dieses Jahr' : Math.ceil(yrs) + ' Jahre') : '> 60 Jahre'}</div><div class="small mut">${when ? when.getFullYear() : ''} bei ${c.save.toLocaleString('de-CH')} CHF/Monat</div></div></div>
    <div class="card"><div class="lbl">Projektion</div>
      ${area(f.proj, { color: SLOTS[2], fmt: (v) => chf(v), ref: { v: f.target, label: 'FI' }, label: 'Projektion bis zur FI-Zahl', height: 150, dateFmt: (t) => String(new Date(t).getFullYear()) })}
      <div class="small mut mt">Heute möglich: ≈ ${chf(f.monthlyIncome)} pro Monat (${c.swr} % pro Jahr) · Annahme ${c.ret} % Rendite real pro Jahr.</div></div>
    <button class="btn line block" data-act="fiedit">Annahmen anpassen</button>
    <div class="small mut">Rechenbeispiel mit deinen Annahmen – keine Anlageberatung. Real = nach Teuerung. Die «4 %-Regel» stammt aus US-Daten; für die Schweiz rechnen viele vorsichtiger mit 3–3.5 %.</div>`;
}
function openFiSettings() {
  const c = P.fiCfg();
  openSheet({
    title: 'FI-Annahmen',
    render: () => `<label class="field"><span>Ausgaben pro Monat (CHF)</span><input name="exp" inputmode="decimal" value="${c.expenses}"></label>
      <label class="field"><span>Sparrate pro Monat (CHF)</span><input name="save" inputmode="decimal" value="${c.save}"></label>
      <div class="grid2"><label class="field"><span>Entnahmerate % / Jahr</span><input name="swr" inputmode="decimal" value="${c.swr}"></label><label class="field"><span>Rendite real % / Jahr</span><input name="ret" inputmode="decimal" value="${c.ret}"></label></div>
      <label class="check"><input type="checkbox" name="ng" ${c.excludeNotgroschen ? 'checked' : ''}> Notgroschen nicht mitzählen</label>
      <button class="btn gold block big mt" data-act="save">Speichern</button>`,
    bind: (el) => el.querySelector('[data-act=save]').addEventListener('click', () => {
      const n = (k) => Number(String(el.querySelector(`[name=${k}]`).value).replace(/['’]/g, '').replace(',', '.'));
      const o = { expenses: n('exp'), save: n('save'), swr: n('swr'), ret: n('ret') };
      if (!(o.expenses > 0) || !(o.save >= 0) || !(o.swr > 0 && o.swr <= 10) || !(o.ret > -5 && o.ret <= 15)) return toast('Werte prüfen');
      Object.assign(c, o, { excludeNotgroschen: el.querySelector('[name=ng]').checked }); commit(); toast('Gespeichert'); closeSheet();
    }),
  });
}
