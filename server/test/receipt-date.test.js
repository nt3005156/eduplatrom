// The printed receipt date is the school's date (Asia/Kathmandu), not the UTC date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptDate } from '../src/services/fees/receiptPdf.js';

test('a payment at 20:18 UTC on 11 Oct is dated 12 Oct on the Nepal receipt', () => {
  assert.equal(receiptDate('2026-10-11 20:18:53'), '2026-10-12');
});

test('a payment at 10:00 UTC is the same day in Nepal', () => {
  assert.equal(receiptDate('2026-10-11 10:00:00'), '2026-10-11');
});

test('the boundary: 18:14:59 UTC is 23:59:59 Nepal (same day); 18:15:00 UTC is the next day', () => {
  assert.equal(receiptDate('2026-10-11 18:14:59'), '2026-10-11');
  assert.equal(receiptDate('2026-10-11 18:15:00'), '2026-10-12');
});
