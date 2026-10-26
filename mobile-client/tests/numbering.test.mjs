import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberPrefix, cleanDeviceCode, nextNumber, findDuplicateNumbers } from '../www/js/numbering.js';

test('first number and continuing a sequence', () => {
  assert.equal(nextNumber([], 'INV-'), 'INV-0001');
  assert.equal(nextNumber(['INV-0001', 'INV-0007', 'INV-0003'], 'INV-'), 'INV-0008');
});

test('device code gives each phone its own sequence', () => {
  const a = numberPrefix('INV-', 'a');
  const b = numberPrefix('INV-', 'B');
  assert.equal(a, 'INV-A-');
  const existing = ['INV-0004', 'INV-A-0002', 'INV-B-0005'];
  assert.equal(nextNumber(existing, a), 'INV-A-0003');
  assert.equal(nextNumber(existing, b), 'INV-B-0006');
  assert.equal(nextNumber(existing, 'INV-'), 'INV-0005');   // device-coded numbers don't affect the plain sequence
});

test('no device code keeps the plain prefix', () => {
  assert.equal(numberPrefix('REC-', ''), 'REC-');
  assert.equal(numberPrefix('REC-', '   '), 'REC-');
});

test('device codes are cleaned to up to 3 letters/digits', () => {
  assert.equal(cleanDeviceCode(' b-2x9 '), 'B2X');
  assert.equal(cleanDeviceCode(''), '');
});

test('duplicate numbers are found per type, ignoring deleted documents and drafts', () => {
  const docs = [
    { type: 'invoice', number: 'INV-0006' },
    { type: 'invoice', number: 'INV-0006' },
    { type: 'invoice', number: 'INV-0007' },
    { type: 'receipt', number: 'INV-0007' },
    { type: 'invoice', number: 'INV-0008' },
    { type: 'invoice', number: 'INV-0008', deletedAt: '2026-10-26T00:00:00Z' },
    { type: 'invoice', number: null },
    { type: 'invoice', number: null },
  ];
  assert.deepEqual(findDuplicateNumbers(docs), ['INV-0006']);
});

test('voiding one copy resolves a duplicate', () => {
  const docs = [{ type: 'invoice', number: 'INV-0006', status: 'void' }, { type: 'invoice', number: 'INV-0006', status: 'issued' }];
  assert.deepEqual(findDuplicateNumbers(docs), []);
});
