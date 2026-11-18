import assert from 'node:assert/strict';
import { test } from 'node:test';
import { env } from 'cloudflare:workers';
import { formatSiteDate, getSiteDateParts, getSiteMonthRange, getSiteTimeZone, getSiteCalendar } from '../src/lib/site-time.ts';

test('site dates default to Shanghai, independent of the runtime time zone', () => {
  delete env.SITE_TIMEZONE;
  assert.equal(getSiteTimeZone(), 'Asia/Shanghai');
  assert.deepEqual(getSiteDateParts('2026-11-17T23:30:00Z'), { year: 2026, month: 11, day: 18, weekday: 3 });
  assert.equal(formatSiteDate('2026-11-17T23:30:00Z'), '2026/11/18');
  assert.equal(formatSiteDate(null), '');
  assert.equal(formatSiteDate('invalid'), '');
});

test('local month and year boundaries use UTC inclusive/exclusive instants', () => {
  assert.deepEqual(getSiteMonthRange('2026-10-31T16:00:00Z'), {
    monthStart: '2026-10-31T16:00:00.000Z', nextMonthStart: '2026-11-30T16:00:00.000Z'
  });
  assert.deepEqual(getSiteDateParts('2026-12-31T16:00:00Z'), { year: 2027, month: 1, day: 1, weekday: 5 });
  assert.deepEqual(getSiteMonthRange('2026-12-31T16:00:00Z'), {
    monthStart: '2026-12-31T16:00:00.000Z', nextMonthStart: '2027-01-31T16:00:00.000Z'
  });
  assert.equal(getSiteCalendar('2026-12-31T16:00:00Z').isoWeek, 53);
  assert.equal(getSiteCalendar('2024-02-28T16:00:00Z').daysInMonth, 29);
});

test('configured DST and fractional-offset zones retain correct month boundaries', () => {
  env.SITE_TIMEZONE = 'America/New_York';
  assert.deepEqual(getSiteMonthRange('2026-03-15T12:00:00Z'), {
    monthStart: '2026-03-01T05:00:00.000Z', nextMonthStart: '2026-04-01T04:00:00.000Z'
  });
  env.SITE_TIMEZONE = 'Asia/Kathmandu';
  assert.equal(getSiteMonthRange('2026-11-18T12:00:00Z').monthStart, '2026-10-31T18:15:00.000Z');
  delete env.SITE_TIMEZONE;
});

test('invalid configuration falls back and warns only once per isolate', () => {
  const original = console.warn;
  let warnings = 0;
  console.warn = () => { warnings += 1; };
  try {
    env.SITE_TIMEZONE = 'Invalid/Zone';
    assert.equal(getSiteTimeZone(), 'Asia/Shanghai');
    assert.equal(getSiteTimeZone(), 'Asia/Shanghai');
    assert.equal(warnings, 1);
  } finally {
    console.warn = original;
    delete env.SITE_TIMEZONE;
  }
});
