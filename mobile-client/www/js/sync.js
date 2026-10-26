import { query, batch, getMeta, ENTITIES } from './db.js';
import { rowToRecord, stripMeta, applyServerStatements } from './repo.js';
import { authed, isLoggedIn } from './api.js';
import { canReachServer, onNetworkChange } from './network.js';
import { resolveConflict } from './conflicts.js';
import { CONFIG } from './config.js';

const PUSH_BATCH = 50;
const MAX_ATTEMPTS = 5;
const OFFLINE_RECHECK_MS = 30 * 1000;
let running = false;
let timer = null;
let retryDelay = 5000;
const status = { state: 'idle', pending: 0, lastSyncAt: null };

const emit = (patch) => {
  Object.assign(status, patch);
  document.dispatchEvent(new CustomEvent('sync:status', { detail: { ...status } }));
};
const pendingCount = async () => (await query('SELECT COUNT(*) AS n FROM outbox'))[0].n;

export function scheduleSync(delay = 3000) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function syncNow() {
  if (running || !CONFIG.API_ORIGIN || !(await isLoggedIn())) return;
  running = true;
  const reachable = await canReachServer();
  if (!reachable && !navigator.onLine) {
    running = false;
    emit({ state: 'offline', pending: await pendingCount() });
    // Don't rely only on the 'online' event – some devices never send it – so check again shortly.
    scheduleSync(OFFLINE_RECHECK_MS);
    return;
  }
  emit({ state: 'syncing' });
  try {
    if (!reachable) throw new Error('Server unreachable');       // network is up but the API is down → retry with backoff
    await push();
    await pull();
    retryDelay = 5000;
    emit({ state: 'synced', lastSyncAt: new Date().toISOString(), pending: await pendingCount() });
  } catch (e) {
    console.warn('Sync failed', e);
    emit({ state: 'failed', pending: await pendingCount() });
    scheduleSync(retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5 * 60 * 1000);   // exponential backoff
  } finally {
    running = false;
  }
}

async function push() {
  for (;;) {
    const queued = await query('SELECT * FROM outbox WHERE attempts < ? ORDER BY queued_at LIMIT ?', [MAX_ATTEMPTS, PUSH_BATCH]);
    if (!queued.length) return;
    const locals = new Map();
    const changes = [];
    for (const q of queued) {
      const [row] = await query(`SELECT * FROM ${ENTITIES[q.entity].table} WHERE id = ?`, [q.record_id]);
      if (!row) { await query('DELETE FROM outbox WHERE entity = ? AND record_id = ?', [q.entity, q.record_id]); continue; }
      const rec = rowToRecord(row);
      locals.set(q.op_id, { q, rec, base: row.synced_data ? JSON.parse(row.synced_data) : null });
      changes.push({ opId: q.op_id, entity: q.entity, id: rec.id, baseVersion: rec.version || 0,
        updatedAt: rec.updatedAt, deletedAt: rec.deletedAt || null, data: stripMeta(rec) });
    }
    if (!changes.length) continue;

    const { results } = await authed('/sync/push', { method: 'POST', body: { changes } });
    for (const r of results) {
      const { q, rec, base } = locals.get(r.opId);
      if (r.status === 'applied' || r.status === 'duplicate') {
        await batch([
          // What we just pushed is now the server copy, i.e. the base for any future conflict.
          [`UPDATE ${ENTITIES[q.entity].table} SET version = ?, synced_data = ? WHERE id = ?`,
            [r.version, JSON.stringify(stripMeta(rec)), q.record_id]],
          // Only clear the outbox if the record wasn't edited again while we were syncing.
          ['DELETE FROM outbox WHERE entity = ? AND record_id = ? AND op_id = ?', [q.entity, q.record_id, q.op_id]],
        ]);
      } else if (r.status === 'conflict') {
        await resolveConflict(q.entity, rec, r.server, base);
      } else {
        await query('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE entity = ? AND record_id = ?', [r.error, q.entity, q.record_id]);
      }
    }
    if (results.every((r) => r.status === 'rejected')) return;   // no progress – stop until next sync
  }
}

async function pull() {
  let since = Number(await getMeta('last_pull_seq') || 0);
  let received = 0;
  for (;;) {
    const { records, nextSince, hasMore } = await authed(`/sync/pull?since=${since}`);
    const stmts = [];
    for (const r of records) {
      const [pending] = await query('SELECT 1 FROM outbox WHERE entity = ? AND record_id = ?', [r.entity, r.id]);
      if (pending) continue;    // local edit wins until it is pushed; the server flags any conflict then
      stmts.push(...applyServerStatements(r.entity, { ...r.data, id: r.id, updatedAt: r.updatedAt, version: r.version, deletedAt: r.deletedAt }));
    }
    // Records and cursor saved together: a crash here just means this page is pulled again.
    stmts.push(['INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['last_pull_seq', String(nextSince)]]);
    await batch(stmts);
    received += records.length;
    since = nextSince;
    if (!hasMore) break;
  }
  if (received) document.dispatchEvent(new CustomEvent('data:pulled'));
}

export function startSync() {
  document.addEventListener('data:changed', async () => {
    if (!(await isLoggedIn())) return;
    // A fresh local change means we are no longer "all backed up".
    emit({ pending: await pendingCount(), ...(status.state === 'synced' && { state: 'idle' }) });
    scheduleSync(3000);
  });
  onNetworkChange(async (up) => {
    if (!(await isLoggedIn())) return;
    if (up) scheduleSync(1000); else emit({ state: 'offline', pending: await pendingCount() });
  });
  document.addEventListener('resume', () => scheduleSync(1000));
  setInterval(syncNow, CONFIG.SYNC_INTERVAL_MS);
  scheduleSync(1000);
}
