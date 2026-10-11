// Unit tests for shared field validation (utils/validate.js).
// These run without a database: the functions are pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIsoDate, normalizePhone, normalizeEmail, parseCsv, GUARDIAN_RELATIONSHIPS } from '../src/utils/validate.js';

test('isIsoDate accepts real calendar dates only', () => {
  assert.equal(isIsoDate('2026-10-11'), true);
  assert.equal(isIsoDate('2024-02-29'), true, 'leap day exists in 2024');
  assert.equal(isIsoDate('2026-02-29'), false, 'not a leap year');
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isIsoDate('2026-1-5'), false, 'must be zero-padded');
  assert.equal(isIsoDate('11/10/2026'), false);
  assert.equal(isIsoDate(20261011), false, 'numbers are not dates');
  assert.equal(isIsoDate(undefined), false);
});

test('normalizePhone turns Nepal mobiles into +977 E.164', () => {
  assert.deepEqual(normalizePhone('9801234567'), { ok: true, value: '+9779801234567' });
  assert.deepEqual(normalizePhone('98-0123-4567'), { ok: true, value: '+9779801234567' });
  assert.deepEqual(normalizePhone('+977 9701234567'), { ok: true, value: '+9779701234567' });
  assert.deepEqual(normalizePhone('009779601234567'), { ok: true, value: '+9779601234567' });
});

test('normalizePhone accepts international E.164 and refuses malformed numbers', () => {
  assert.deepEqual(normalizePhone('+14155550123'), { ok: true, value: '+14155550123' });
  assert.deepEqual(normalizePhone('0014155550123'), { ok: true, value: '+14155550123' });
  assert.equal(normalizePhone('12345').ok, false, 'too short');
  assert.equal(normalizePhone('9901234567').ok, false, 'not a Nepal mobile prefix (99)');
  assert.equal(normalizePhone('+0123456789').ok, false, 'country code cannot start with 0');
  assert.equal(normalizePhone('98012abc67').ok, false, 'letters are refused');
});

test('normalizePhone treats blank as "no phone", not an error', () => {
  assert.deepEqual(normalizePhone(''), { ok: true, value: null });
  assert.deepEqual(normalizePhone('   '), { ok: true, value: null });
  assert.deepEqual(normalizePhone(null), { ok: true, value: null });
});

test('normalizeEmail lowercases and trims; rejects malformed addresses', () => {
  assert.equal(normalizeEmail('  Ram.Sharma@Example.COM '), 'ram.sharma@example.com');
  assert.equal(normalizeEmail('no-at-sign.example.com'), null);
  assert.equal(normalizeEmail('a b@example.com'), null, 'spaces are refused');
  assert.equal(normalizeEmail('x@y'), null, 'needs a dot in the domain');
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail('a'.repeat(250) + '@x.io'), null, 'over 254 characters');
});

test('parseCsv handles quotes, doubled quotes, CRLF, BOM and blank lines', () => {
  const rows = parseCsv('\uFEFFname,note\r\n"Shah, Asha","said ""hi"""\r\n\r\nRam,plain\n');
  assert.deepEqual(rows, [
    ['name', 'note'],
    ['Shah, Asha', 'said "hi"'],
    ['Ram', 'plain'],
  ]);
});

test('parseCsv keeps empty middle cells and a trailing empty cell', () => {
  assert.deepEqual(parseCsv('a,,c\n1,2,'), [['a', '', 'c'], ['1', '2', '']]);
});

test('parseCsv refuses an unclosed quoted field instead of guessing', () => {
  assert.throws(() => parseCsv('name\n"Asha,7'), /unclosed quoted field/);
});

test('guardian relationships are a fixed list', () => {
  assert.deepEqual(GUARDIAN_RELATIONSHIPS, ['father', 'mother', 'guardian', 'grandparent', 'other']);
});
