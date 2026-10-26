import { documentTotals } from './money.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// True when two records hold the same values, regardless of key order.
export const sameRecord = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => same(a[k], b[k]));
const mergeById = (a = [], b = []) => [...new Map([...a, ...b].map((x) => [x.id, x])).values()];

// Totals are recalculated from lines + payments, so they never count as conflicting edits.
const DERIVED = new Set(['subtotalPence', 'taxPence', 'totalPence', 'paidPence', 'payments']);

// Three-way merge of two versions of a record against the last version both sides had synced (`base`).
// Pure function (no DOM / database) so it can be unit tested in Node.
export function mergeRecords(entity, local, remote, base, localIsNewer) {
  const merged = {};
  let clashed = false;
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    if (entity === 'document' && DERIVED.has(key)) continue;
    const [l, r] = [local[key], remote[key]];
    let value;
    if (same(l, r)) value = l;
    else if (base && same(l, base[key])) value = r;         // only the other device changed it
    else if (base && same(r, base[key])) value = l;         // only this device changed it
    else { clashed = true; value = localIsNewer ? l : r; }  // both changed it (or no base): newest wins
    if (value !== undefined) merged[key] = value;
  }
  if (entity === 'document') {
    merged.payments = mergeById(local.payments, remote.payments);   // a recorded payment is never lost
    const { balancePence, ...totals } = documentTotals(merged.lines, merged.payments);
    Object.assign(merged, totals);
  }
  return { merged, clashed };
}
