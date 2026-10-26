import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecords, sameRecord } from '../www/js/merge.js';

const line = { id: 'l1', description: 'Window cleaning', quantity: 1, unitPricePence: 5000, taxRatePercent: 20 };
const base = {
  type: 'invoice', status: 'issued', number: 'INV-0002', notes: '', lines: [line], payments: [],
  subtotalPence: 5000, taxPence: 1000, totalPence: 6000, paidPence: 0,
};

test('edits to different fields on two devices are both kept', () => {
  const local = { ...base, notes: 'Gate code 1234' };                                                  // offline phone
  const remote = { ...base, payments: [{ id: 'p1', amountPence: 2500 }], paidPence: 2500 };          // other device
  const { merged, clashed } = mergeRecords('document', local, remote, base, false);
  assert.equal(clashed, false);
  assert.equal(merged.notes, 'Gate code 1234');
  assert.equal(merged.paidPence, 2500);
  assert.equal(merged.totalPence, 6000);
});

test('the same field changed on both devices: newest wins and it is flagged', () => {
  const local = { ...base, notes: 'From this phone' };
  const remote = { ...base, notes: 'From the other phone' };
  assert.deepEqual(mergeRecords('document', local, remote, base, true).merged.notes, 'From this phone');
  const older = mergeRecords('document', local, remote, base, false);
  assert.equal(older.merged.notes, 'From the other phone');
  assert.equal(older.clashed, true);
});

test('payments from both devices are combined and totals recalculated', () => {
  const local = { ...base, payments: [{ id: 'a', amountPence: 1000 }] };
  const remote = { ...base, payments: [{ id: 'b', amountPence: 2000 }] };
  const { merged } = mergeRecords('document', local, remote, base, true);
  assert.equal(merged.payments.length, 2);
  assert.equal(merged.paidPence, 3000);
});

test('line edits on one device and payment on another recalculate totals from both', () => {
  const local = { ...base, lines: [{ ...line, quantity: 2 }] };
  const remote = { ...base, payments: [{ id: 'p', amountPence: 6000 }] };
  const { merged, clashed } = mergeRecords('document', local, remote, base, false);
  assert.equal(clashed, false);
  assert.equal(merged.totalPence, 12000);
  assert.equal(merged.paidPence, 6000);
});

test('without a base (first sync after upgrade) it falls back to newest-wins', () => {
  const { merged, clashed } = mergeRecords('customer', { name: 'A', phone: '1' }, { name: 'B', phone: '1' }, null, true);
  assert.equal(merged.name, 'A');
  assert.equal(clashed, true);
});

test('customer fields merge independently', () => {
  const b = { name: 'Ada', phone: '', email: '' };
  const { merged, clashed } = mergeRecords('customer', { ...b, phone: '0770' }, { ...b, email: 'ada@example.com' }, b, false);
  assert.deepEqual(merged, { name: 'Ada', phone: '0770', email: 'ada@example.com' });
  assert.equal(clashed, false);
});

test('sameRecord ignores key order', () => {
  assert.equal(sameRecord({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(sameRecord({ a: 1 }, { a: 2 }), false);
});
