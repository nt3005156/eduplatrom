// Pure fee policy: NPR formatting, escalation tiers, and the overpayment notice template. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNPR, escalationTiers, tierFor } from '../src/services/fees/money.js';
import { overpaymentNotice } from '../src/services/fees/notices.js';

test('amounts are shown in NPR, with Nepali lakh grouping and two decimals', () => {
  assert.equal(formatNPR(500000), 'NPR 5,000.00');
  assert.equal(formatNPR(10000000), 'NPR 1,00,000.00');
  assert.equal(formatNPR(12345678), 'NPR 1,23,456.78');
  assert.equal(formatNPR(5), 'NPR 0.05');
  assert.equal(formatNPR(0), 'NPR 0.00');
  assert.equal(formatNPR(-50000), '-NPR 500.00');
  assert.throws(() => formatNPR(100.5), TypeError, 'fractional paisa is refused');
  assert.throws(() => formatNPR('100'), TypeError, 'a string is refused');
});

test('default tiers: below NPR 10,000 is low; NPR 10,000 to 50,000 is medium; above NPR 50,000 is high', () => {
  assert.deepEqual(escalationTiers({}), { supervisor: 1000000, head: 5000000 });
  assert.equal(tierFor(999999), 'low');
  assert.equal(tierFor(1000000), 'supervisor', 'exactly NPR 10,000 is medium');
  assert.equal(tierFor(5000000), 'supervisor', 'exactly NPR 50,000 is medium');
  assert.equal(tierFor(5000001), 'head_of_finance');
  assert.equal(tierFor(null), 'supervisor', 'an unknown amount is looked at by a person');
});

test('tiers can be configured, and a bad configuration is refused', () => {
  const env = { FEES_TIER_SUPERVISOR_PAISA: '200000', FEES_TIER_HEAD_PAISA: '900000' };
  assert.deepEqual(escalationTiers(env), { supervisor: 200000, head: 900000 });
  assert.equal(tierFor(199999, escalationTiers(env)), 'low');
  assert.equal(tierFor(900001, escalationTiers(env)), 'head_of_finance');
  assert.throws(() => escalationTiers({ FEES_TIER_SUPERVISOR_PAISA: '900000', FEES_TIER_HEAD_PAISA: '200000' }), /greater than/);
  assert.throws(() => escalationTiers({ FEES_TIER_HEAD_PAISA: 'fifty thousand' }), /positive whole number/);
  assert.throws(() => escalationTiers({ FEES_TIER_SUPERVISOR_PAISA: '-5' }), /positive whole number/);
});

test('the overpayment notice uses the agreed wording, in NPR', () => {
  const n = overpaymentNotice({ parentName: 'Sita Sharma', amount_paisa: 250000, refundUrl: 'https://school.example.test/refund/abc' });
  assert.equal(n.subject, 'Overpayment credited to your account');
  assert.match(n.body, /^Dear Sita Sharma,/);
  assert.match(n.body, /An overpayment of NPR 2,500\.00 was detected and credited to your account\. Click here if you prefer a direct refund to your original payment method: https:\/\/school\.example\.test\/refund\/abc/);
  assert.doesNotMatch(n.body, /\$/, 'no dollar sign');
});

test('the overpayment notice will not render without an https refund link, or with a bad amount', () => {
  assert.throws(() => overpaymentNotice({ amount_paisa: 100 }), /refundUrl/);
  assert.throws(() => overpaymentNotice({ amount_paisa: 100, refundUrl: 'http://insecure.example.test/x' }), /refundUrl/);
  assert.throws(() => overpaymentNotice({ amount_paisa: 0, refundUrl: 'https://school.example.test/x' }), TypeError);
  const generic = overpaymentNotice({ amount_paisa: 100, refundUrl: 'https://school.example.test/x' });
  assert.match(generic.body, /^Dear parent or guardian,/);
});
