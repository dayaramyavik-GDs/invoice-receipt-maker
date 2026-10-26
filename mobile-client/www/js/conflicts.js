import { batch } from './db.js';
import { upsertStatements, applyServerStatements, stripMeta, uuid } from './repo.js';
import { mergeRecords, sameRecord } from './merge.js';

// Resolves a push that the server rejected because another device changed the record first.
// Fields changed on only one device are combined; only a field changed on both devices is a real
// conflict (newest edit wins, and for documents the other copy is kept for the user to review).
export async function resolveConflict(entity, local, server, base) {
  const remote = { ...server.data, id: server.id, updatedAt: server.updatedAt, version: server.version, deletedAt: server.deletedAt };
  const { merged, clashed } = mergeRecords(entity, stripMeta(local), stripMeta(remote), base, local.updatedAt > remote.updatedAt);
  const stmts = [];

  if (clashed && entity === 'document') {
    stmts.push(['INSERT INTO conflicts (id, entity, record_id, local_data, server_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), entity, local.id, JSON.stringify(local), JSON.stringify(remote), new Date().toISOString()]]);
  }

  const deletedAt = local.deletedAt && remote.deletedAt ? remote.deletedAt : (local.deletedAt || remote.deletedAt || null);
  if (sameRecord(merged, stripMeta(remote)) && deletedAt === (remote.deletedAt || null)) {
    // Nothing of ours is left to send: take the server copy and drop the queued change.
    stmts.push(...applyServerStatements(entity, remote), ['DELETE FROM outbox WHERE entity = ? AND record_id = ?', [entity, local.id]]);
  } else {
    // Re-queue the merged record on top of the server's version so the next push is accepted,
    // and remember the server copy as the new base.
    stmts.push(...applyServerStatements(entity, remote));
    stmts.push(...upsertStatements(entity, { ...merged, id: local.id, version: remote.version, deletedAt, updatedAt: new Date().toISOString() }));
  }
  await batch(stmts);
}
