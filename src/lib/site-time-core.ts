// This module is safe to import in the browser: no Worker environment or secrets.
export const DEFAULT_SITE_TIMEZONE = 'Asia/Shanghai';
export type SiteDateValue = Date | string | number | null | undefined;
export type SiteDateStyle = 'numeric' | 'long' | 'month-day';
let warnedAboutInvalidTimeZone = false;
let lastCandidate = '';
let lastResolved = DEFAULT_SITE_TIMEZONE;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function resolveSiteTimeZone(value?: string): string {
  const candidate = value?.trim() || DEFAULT_SITE_TIMEZONE;
  if (candidate === lastCandidate) return lastResolved;
  lastCandidate = candidate;
  try {
    lastResolved = new Intl.DateTimeFormat('en-US', { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    if (!warnedAboutInvalidTimeZone) {
      warnedAboutInvalidTimeZone = true;
      console.warn('[site-time] Invalid SITE_TIMEZONE; using Asia/Shanghai.');
    }
    lastResolved = DEFAULT_SITE_TIMEZONE;
  }
  return lastResolved;
}

export function getSiteTimeZone(): string {
  return resolveSiteTimeZone(typeof document === 'undefined' ? undefined : document.documentElement.dataset.siteTimezone);
}

function asDate(value: SiteDateValue): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatter(timeZone: string, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${timeZone}:${key}`;
  let result = formatters.get(cacheKey);
  if (!result) {
    result = new Intl.DateTimeFormat('zh-CN', { ...options, timeZone });
    // Only a handful of configured zones are normally used, but bound isolate memory.
    if (formatters.size >= 64) formatters.clear();
    formatters.set(cacheKey, result);
  }
  return result;
}

export function formatSiteDate(value: SiteDateValue, style: SiteDateStyle = 'numeric', timeZone = getSiteTimeZone()): string {
  const date = asDate(value);
  if (!date) return '';
  const options: Intl.DateTimeFormatOptions = style === 'long'
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { ...(style === 'month-day' ? {} : { year: 'numeric' as const }), month: '2-digit', day: '2-digit' };
  return formatter(timeZone, style, options).format(date);
}

export function formatSiteDateTime(value: SiteDateValue, timeZone = getSiteTimeZone()): string {
  const date = asDate(value);
  return date ? formatter(timeZone, 'datetime', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(date) : '';
}

export function getSiteDateParts(value: SiteDateValue = new Date(), timeZone = getSiteTimeZone()) {
  const date = asDate(value);
  if (!date) throw new RangeError('Invalid site date.');
  const parts = formatter(timeZone, 'parts', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = number('year');
  const month = number('month');
  const day = number('day');
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

export function getSiteMonthRange(value: SiteDateValue = new Date(), timeZone = getSiteTimeZone()) {
  const { year, month } = getSiteDateParts(value, timeZone);
  // Find the first instant in a local month, including midnight offset changes.
  // Searching by local year/month handles DST gaps without assuming a fixed offset.
  function boundary(targetYear: number, targetMonth: number): string {
    const target = targetYear * 12 + targetMonth - 1;
    const approximate = Date.UTC(targetYear, targetMonth - 1, 1);
    let low = approximate - 2 * 86_400_000;
    let high = approximate + 2 * 86_400_000;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const local = getSiteDateParts(middle, timeZone);
      if (local.year * 12 + local.month - 1 >= target) high = middle;
      else low = middle + 1;
    }
    return new Date(low).toISOString();
  }
  return {
    monthStart: boundary(year, month),
    nextMonthStart: boundary(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)
  };
}

export function getSiteCalendar(value: SiteDateValue = new Date(), timeZone = getSiteTimeZone()) {
  const parts = getSiteDateParts(value, timeZone);
  const { year, month, day } = parts;
  const localDay = Date.UTC(year, month - 1, day);
  const weekDate = new Date(localDay);
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - (weekDate.getUTCDay() || 7));
  return {
    ...parts,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    monthStartDay: new Date(Date.UTC(year, month - 1, 1)).getUTCDay(),
    dayOfYear: Math.floor((localDay - Date.UTC(year, 0, 1)) / 86_400_000) + 1,
    isoWeek: Math.ceil(((weekDate.getTime() - Date.UTC(weekDate.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)
  };
}
