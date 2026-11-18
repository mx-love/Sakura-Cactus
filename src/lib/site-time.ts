import { env } from 'cloudflare:workers';
import * as time from './site-time-core';
import type { SiteDateStyle, SiteDateValue } from './site-time-core';

export function getSiteTimeZone(): string {
  return time.resolveSiteTimeZone(env.SITE_TIMEZONE);
}

export const formatSiteDate = (value: SiteDateValue, style: SiteDateStyle = 'numeric') => time.formatSiteDate(value, style, getSiteTimeZone());
export const formatSiteDateTime = (value: SiteDateValue) => time.formatSiteDateTime(value, getSiteTimeZone());
export const getSiteDateParts = (date: SiteDateValue = new Date()) => time.getSiteDateParts(date, getSiteTimeZone());
export const getSiteMonthRange = (date: SiteDateValue = new Date()) => time.getSiteMonthRange(date, getSiteTimeZone());
export const getSiteCalendar = (date: SiteDateValue = new Date()) => time.getSiteCalendar(date, getSiteTimeZone());
