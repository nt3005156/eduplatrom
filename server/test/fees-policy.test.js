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

test('the overpayment notice (version 1) states the amount in NPR and points to the accounts desk, with no link', () => {
  const n = overpaymentNotice({ parentName: 'Sita Sharma', amount_paisa: 250000 });
  assert.equal(n.subject, 'Overpayment credited to your account');
  assert.match(n.body, /^Dear Sita Sharma,/);
  assert.match(n.body, /An overpayment of NPR 2,500\.00 was detected and credited to your account\./);
  assert.match(n.body, /contact the school accounts desk/);
  assert.doesNotMatch(n.body, /https?:\/\//, 'no refund link in version 1');
  assert.doesNotMatch(n.body, /Click here/i, 'the link wording is deferred to version 2');
  assert.doesNotMatch(n.body, /\$/, 'no dollar sign');
  assert.match(n.body, /This is an automated billing and financial balance notification regarding your institutional account\./, 'transactional footer');
  assert.doesNotMatch(n.body, /unsubscribe/i, 'no unsubscribe link on a mandatory billing notice');
  const generic = overpaymentNotice({ amount_paisa: 100 });
  assert.match(generic.body, /^Dear parent or guardian,/);
});

test('the overpayment notice refuses a zero or fractional amount', () => {
  assert.throws(() => overpaymentNotice({ amount_paisa: 0 }), TypeError);
  assert.throws(() => overpaymentNotice({ amount_paisa: 100.5 }), TypeError);
});
