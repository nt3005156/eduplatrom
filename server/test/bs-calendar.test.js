// Phase 5: Bikram Sambat conversion. Golden month starts, full round trip, and bad input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bsToAd, adToBs, formatBsNepali, isValidBs, parseBs, BS_VERIFIED_MAX_YEAR } from '../src/utils/bsDate.js';
import { schoolDate } from '../src/utils/schoolTime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, 'golden', 'bs-month-starts.json'), 'utf8'));

test('golden: every month start from BS 2070 to 2083 converts both ways', () => {
  assert.equal(golden.months.length, 14 * 12, 'fixture covers 14 full years');
  for (const { bs, ad } of golden.months) {
    assert.equal(bsToAd(bs), ad, `BS ${bs} -> AD`);
    assert.equal(adToBs(ad), bs, `AD ${ad} -> BS`);
  }
});

test('the verified range covers at least 10 years around the current date', () => {
  const today = schoolDate(new Date('2026-10-11T20:00:00Z')); // the school's "today" that day
  const bsToday = adToBs(today);
  assert.equal(today, '2026-10-12');
  assert.equal(bsToday, '2083-06-26');
  assert.ok(BS_VERIFIED_MAX_YEAR >= Number(bsToday.slice(0, 4)), 'today is inside the verified range');
  assert.ok(Number(bsToday.slice(0, 4)) - 2070 >= 10 - 1, 'verified back to BS 2070');
});

test('round trip: every day from BS 2070-01-01 to 2083-12-30 is unique and continuous', () => {
  const startAd = Date.parse(golden.months[0].ad + 'T00:00:00Z');
  // The verified range ends the day before BS 2084-01-01 (AD 2027-04-14).
  const endAd = '2027-04-13';
  assert.ok(adToBs(endAd).startsWith('2083-12-'), 'last verified day is in Chaitra 2083');
  let prevBs = null, days = 0;
  for (let t = startAd; t <= Date.parse(endAd + 'T00:00:00Z'); t += 86400000) {
    const ad = new Date(t).toISOString().slice(0, 10);
    const bs = adToBs(ad);
    assert.ok(bs, `AD ${ad} converts`);
    assert.equal(bsToAd(bs), ad, `round trip ${ad}`);
    if (prevBs) {
      // Continuity in BS: same month -> day + 1; new month -> day 1 of the next month (or January of the next year).
      const [py, pm, pd] = prevBs.split('-').map(Number);
      const [y, m, d] = bs.split('-').map(Number);
      if (y === py && m === pm) assert.equal(d, pd + 1, `${prevBs} then ${bs}`);
      else {
        assert.equal(d, 1, `${prevBs} then ${bs}`);
        assert.ok((y === py && m === pm + 1) || (y === py + 1 && m === 1 && pm === 12), `${prevBs} then ${bs}`);
      }
    }
    prevBs = bs;
    days++;
  }
  assert.ok(days > 5000, `about 14 years of days (${days})`);
});

test('known anchors: Baisakh 1 of recent years', () => {
  assert.equal(bsToAd('2081-01-01'), '2024-04-13');
  assert.equal(bsToAd('2082-01-01'), '2025-04-14');
  assert.equal(bsToAd('2083-01-01'), '2026-04-14');
});

test('a school date late in the UTC day moves to the next BS day', () => {
  assert.equal(adToBs(schoolDate(new Date('2026-10-11T18:15:00Z'))), '2083-06-26');
  assert.equal(adToBs(schoolDate(new Date('2026-10-11T18:14:59Z'))), '2083-06-25');
});

test('invalid BS dates are refused, not guessed', () => {
  assert.equal(bsToAd('2083-02-32'), null, 'day past the end of the month');
  assert.equal(bsToAd('2083-13-01'), null, 'month 13');
  assert.equal(bsToAd('2083-00-10'), null, 'month 0');
  assert.equal(bsToAd('2069-01-01'), null, 'before the supported range');
  assert.equal(bsToAd('2091-01-01'), null, 'after the supported range');
  assert.equal(bsToAd('2083-1-1'), null, 'not zero padded');
  assert.equal(bsToAd('not a date'), null);
  assert.equal(bsToAd(null), null);
  assert.equal(isValidBs(2083, 1, 32), false);
  assert.equal(isValidBs(2083, 13, 1), false);
  assert.equal(parseBs('2083-06-26').day, 26);
});

test('invalid AD dates are refused', () => {
  assert.equal(adToBs('2026-02-30'), null, 'no such day');
  assert.equal(adToBs('2026-13-01'), null);
  assert.equal(adToBs('12/10/2026'), null);
  assert.equal(adToBs(undefined), null);
});

test('Nepali display uses Devanagari digits and the month name', () => {
  assert.equal(formatBsNepali('2083-06-26'), '२६ असोज २०८३');
  assert.equal(formatBsNepali('2083-02-32'), '', 'invalid date prints nothing');
});
