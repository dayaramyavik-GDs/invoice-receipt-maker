import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPence, lineTotals, documentTotals, addDays, deriveStatus, formatMoney } from '../www/js/money.js';

test('avoids floating point errors', () => {
  assert.equal(toPence('0.1') + toPence('0.2'), 30);
  assert.equal(toPence('£1,234.56'), 123456);
});

test('rejects invalid amounts', () => {
  assert.throws(() => toPence('abc'), /Invalid amount/);
});

test('line with 20% VAT rounds tax to the nearest penny', () => {
  assert.deepEqual(lineTotals({ quantity: 3, unitPricePence: 1999, taxRatePercent: 20 }), { net: 5997, tax: 1199, total: 7196 });
});

test('fractional hours and part payments', () => {
  const t = documentTotals([{ quantity: 1.5, unitPricePence: 3000, taxRatePercent: 0 }], [{ amountPence: 2000 }]);
  assert.equal(t.totalPence, 4500);
  assert.equal(t.balancePence, 2500);
});

test('due date crosses month end', () => {
  assert.equal(addDays('2026-01-25', 14), '2026-02-08');
});

test('derived statuses', () => {
  const base = { status: 'issued', totalPence: 1000, dueDate: '2026-01-31' };
  assert.equal(deriveStatus({ ...base, paidPence: 0 }, '2026-02-01'), 'overdue');
  assert.equal(deriveStatus({ ...base, paidPence: 1000 }, '2026-02-01'), 'paid');
  assert.equal(deriveStatus({ ...base, paidPence: 0 }, '2026-01-10'), 'unpaid');
  assert.equal(deriveStatus({ ...base, paidPence: 400 }, '2026-01-10'), 'part-paid');
  assert.equal(deriveStatus({ ...base, status: 'draft', paidPence: 0 }), 'draft');
});

test('formats pounds', () => {
  assert.equal(formatMoney(7196), '£71.96');
});
