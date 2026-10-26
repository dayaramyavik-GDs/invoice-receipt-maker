import { batch } from './db.js';
import { upsertStatements, applyServerStatements, stripMeta, uuid } from './repo.js';
import { documentTotals } from './money.js';

const mergeById = (a = [], b = []) => [...new Map([...a, ...b].map((x) => [x.id, x])).values()];

// Policy: newest edit wins; for documents, payments from both sides are kept and the losing copy is saved for review.
export async function resolveConflict(entity, local, server) {
  const remote = { ...server.data, id: server.id, updatedAt: server.updatedAt, version: server.version, deletedAt: server.deletedAt };
  const localNewer = local.updatedAt > remote.updatedAt;
  let winner = localNewer ? local : remote;
  const loser = localNewer ? remote : local;
  const stmts = [];

  if (entity === 'document') {
    const payments = mergeById(local.payments, remote.payments);
    if (payments.length !== (winner.payments || []).length) {
      const { balancePence, ...totals } = documentTotals(winner.lines, payments);
      winner = { ...winner, payments, ...totals };          // nobody loses a recorded payment
    }
    if (JSON.stringify(stripMeta(loser)) !== JSON.stringify(stripMeta(winner))) {
      stmts.push(['INSERT INTO conflicts (id, entity, record_id, local_data, server_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), entity, local.id, JSON.stringify(local), JSON.stringify(remote), new Date().toISOString()]]);
    }
  }

  if (winner === remote) {
    stmts.push(...applyServerStatements(entity, remote), ['DELETE FROM outbox WHERE entity = ? AND record_id = ?', [entity, local.id]]);
  } else {
    // Re-queue on top of the server's version so the next push is accepted.
    stmts.push(...upsertStatements(entity, { ...winner, version: remote.version, updatedAt: new Date().toISOString() }));
  }
  await batch(stmts);
}
