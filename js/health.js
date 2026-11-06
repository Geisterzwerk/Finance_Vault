// =====================================================================
// health.js – Finance Health: Ist alles aktuell, gesichert und stimmig?
// Jede Prüfung: ok / warn / bad + was zu tun ist. Der Score ist der
// gewichtete Anteil erfüllter Punkte (Backup zählt doppelt).
// =====================================================================
import { S } from './store.js';
import { reviewCount } from './calc.js';
import { reconcile } from './auto.js';
import { calendar, reservePlan } from './taxcal.js';
import { missingOpenings } from './estimate.js';
import { daysUntil } from './ui.js';

const DAY = 864e5;
const age = (iso) => (iso ? (Date.now() - new Date(iso)) / DAY : Infinity);
const fmtAge = (d) => (d === Infinity ? 'nie' : d < 1 ? 'heute' : d < 2 ? 'gestern' : `vor ${Math.floor(d)} Tagen`);

export const meta = () => (S().meta ||= { lastBackup: null, lastBackupTest: null });

export function checks() {
  const s = S(); const m = meta(); const out = [];
  const add = (id, label, st, detail, go, weight = 1) => out.push({ id, label, st, detail, go, weight });
  // Sicherheit / Zuverlässigkeit
  const ab = s.autoBackup || {};
  const sb = age(ab.enabled ? ab.lastAt : null);
  const b = Math.min(age(m.lastBackup), sb);
  add('backup', 'Backup', b <= 31 ? 'ok' : b <= 90 ? 'warn' : 'bad', `letztes Backup ${fmtAge(b)}${sb === b && sb !== Infinity ? ' (Server)' : ''}${b > 31 ? ' – monatlich empfohlen' : ''}`, 'backup', 2);
  if (s.server && s.server.token) {
    const err = ab.lastError && (!ab.lastAt || ab.lastError.at > ab.lastAt);
    add('serverbackup', 'Server-Backup', !ab.enabled ? 'warn' : sb <= 8 && !err ? 'ok' : sb <= 21 ? 'warn' : 'bad',
      !ab.enabled ? 'nicht eingerichtet – bei Verlust des iPhones alles per Knopfdruck zurück' : err ? `Fehler: ${ab.lastError.msg}` : `automatisch, zuletzt ${fmtAge(sb)}`, '#/vault/einstellungen');
  }
  const bt = m.lastBackupTest; const bta = age(bt && bt.at);
  add('backuptest', 'Backup-Test', bt && bt.ok && bta <= 183 ? 'ok' : bt && bt.ok ? 'warn' : 'bad', bt ? (bt.ok ? `bestanden ${fmtAge(bta)} (${bt.tx} Transaktionen, ${bt.files} Dateien)` : `fehlgeschlagen: ${bt.error}`) : 'noch nie getestet – lässt sich das Backup wirklich öffnen?', 'backuptest', 2);
  add('autolock', 'Automatische Sperre', (s.settings.autoLockMin || 5) <= 5 ? 'ok' : 'warn', `nach ${s.settings.autoLockMin || 5} Min.`, '#/vault/einstellungen');
  // Aktualität
  if (s.server && s.server.token) add('server', 'Eigener Server', s.server.status && s.server.status.ok && age(s.server.lastSync) < 2 ? 'ok' : 'warn', s.server.status ? `${s.server.status.msg} · Abgleich ${fmtAge(age(s.server.lastSync))}` : 'noch nie abgeglichen', '#/vault/einstellungen');
  const pa = age(s.pricesAt);
  if (s.transactions.length) add('prices', 'Kurse', pa < 1 ? 'ok' : pa < 7 ? 'warn' : 'bad', `Stand ${fmtAge(pa)}`, 'refresh');
  const stale = s.accounts.filter((a) => !a.auto && age(a.updated) > 40);
  if (s.accounts.length) add('accounts', 'Kontostände', !stale.length ? 'ok' : stale.length <= 2 ? 'warn' : 'bad', stale.length ? `${stale.length} älter als 40 Tage: ${stale.slice(0, 3).map((a) => a.name).join(', ')}` : 'alle aktuell', '#/invest');
  // Stimmigkeit
  const rc = reviewCount();
  add('review', 'Offene Zuordnungen', !rc ? 'ok' : rc <= 5 ? 'warn' : 'bad', rc ? `${rc} Transaktion${rc > 1 ? 'en' : ''} warten` : 'keine', '#/vault/pruefen');
  const r = reconcile();
  if (r.ready) add('reconcile', 'Abgleich Ledger + BingX', !r.bad.length ? 'ok' : 'warn', r.bad.length ? `Abweichung bei ${r.bad.slice(0, 4).map((x) => x.k).join(', ')}` : 'alles stimmt', '#/vault/ledger');
  const mo = missingOpenings().length;
  if (s.transactions.length) add('cost', 'Kaufpreise', !mo ? 'ok' : 'warn', mo ? `${mo} Buchung${mo > 1 ? 'en' : ''} ohne Kaufpreis` : 'vollständig', '#/invest');
  const autoIds = Object.entries(s.coins || {}).filter(([, c]) => c.auto).map(([k]) => k);
  if (autoIds.length) add('ids', 'Kurs-Zuordnung prüfen', 'warn', `automatisch gefunden: ${autoIds.slice(0, 4).join(', ')}`, '#/invest');
  // Zahlungen & Steuern
  const over = s.invoices.filter((i) => i.status === 'open' && i.due && daysUntil(i.due) < 0);
  add('invoices', 'Rechnungen', !over.length ? 'ok' : 'bad', over.length ? `${over.length} überfällig` : 'nichts überfällig', '#/rechnungen');
  const nx = calendar().find((x) => !x.done);
  if (nx) add('tax', 'Steuerfristen', nx.days < 0 ? 'bad' : nx.days <= 21 ? 'warn' : 'ok', `${nx.type === 'file' ? 'Erklärung ' + nx.year : nx.title}: ${nx.days < 0 ? 'überfällig' : 'in ' + nx.days + ' Tagen'}`, '#/steuern');
  const rp = reservePlan();
  if (rp.total > 0 && rp.account) add('reserve', 'Steuer-Rücklage', rp.coverage >= 0.9 ? 'ok' : rp.coverage >= 0.5 ? 'warn' : 'bad', `${Math.round(rp.coverage * 100)} % gedeckt`, '#/steuern');
  const ng = s.accounts.find((a) => a.tag === 'notgroschen'); const ngGoal = s.goals.find((g) => g.kind === 'account' && ng && g.accountId === ng.id);
  if (ng) { const target = ngGoal ? Math.min(...ngGoal.milestones) : 0; add('notgroschen', 'Notgroschen', !target || +ng.value >= target ? 'ok' : 'warn', target ? `${Math.round((+ng.value / target) * 100)} % von CHF ${target}` : `CHF ${Math.round(+ng.value)}`, '#/ziele'); }
  else add('notgroschen', 'Notgroschen', 'warn', 'kein Konto als Notgroschen markiert', '#/invest');
  return out;
}
export function score(list = checks()) {
  const W = list.reduce((a, c) => a + c.weight, 0);
  const pts = list.reduce((a, c) => a + c.weight * (c.st === 'ok' ? 1 : c.st === 'warn' ? 0.5 : 0), 0);
  return W ? Math.round((pts / W) * 100) : 100;
}
