import assert from 'node:assert/strict';
import { test } from 'node:test';
import { env } from 'cloudflare:workers';
import { formatSiteDate, getSiteDateParts, getSiteMonthRange, getSiteTimeZone, getSiteCalendar } from '../src/lib/site-time.ts';
import { CHINESE_NEW_YEAR_DATES, getGanzhiYear } from '../src/lib/ganzhi-year.ts';

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

test('Ganzhi changes at Chinese New Year in the site timezone, not January 1', () => {
  assert.equal(getGanzhiYear(getSiteDateParts('2026-02-16T12:00:00+08:00')), '乙巳蛇年');
  assert.equal(getGanzhiYear(getSiteDateParts('2026-02-17T00:00:00+08:00')), '丙午马年');
  assert.equal(getGanzhiYear(getSiteDateParts('2026-02-16T15:59:59Z')), '乙巳蛇年');
  assert.equal(getGanzhiYear(getSiteDateParts('2026-02-16T16:00:00Z')), '丙午马年');
  // These dates differ in some ICU Chinese-calendar implementations.
  assert.equal(getGanzhiYear({ year: 2027, month: 2, day: 5 }), '丙午马年');
  assert.equal(getGanzhiYear({ year: 2027, month: 2, day: 6 }), '丁未羊年');
  assert.equal(getGanzhiYear({ year: 2030, month: 2, day: 2 }), '己酉鸡年');
  assert.equal(getGanzhiYear({ year: 2030, month: 2, day: 3 }), '庚戌狗年');
});

test('verified table covers every year from 2024 through 2040 and has explicit fallback', () => {
  assert.deepEqual(Object.keys(CHINESE_NEW_YEAR_DATES).map(Number), Array.from({ length: 17 }, (_, index) => 2024 + index));
  for (const [year, monthDay] of Object.entries(CHINESE_NEW_YEAR_DATES)) {
    const instant = new Date(`${year}-${monthDay}T00:00:00+08:00`).getTime();
    assert.notEqual(getGanzhiYear(getSiteDateParts(instant - 1)), getGanzhiYear(getSiteDateParts(instant)));
  }
  assert.equal(getGanzhiYear({ year: 2041, month: 1, day: 1 }), '辛酉鸡年');
  assert.equal(getGanzhiYear({ year: 2023, month: 1, day: 1 }), '癸卯兔年');
});
