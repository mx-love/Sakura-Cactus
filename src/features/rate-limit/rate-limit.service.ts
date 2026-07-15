import { getDb } from '@/lib/db';
import {
  clearRateLimitWithDb,
  consumeRateLimitWithDb,
  type RateLimitInput,
  type RateLimitResult
} from './rate-limit.core';

export {
  clearRateLimitWithDb,
  consumeRateLimitWithDb,
  getRateLimitWindow,
  normalizeRateLimitKey,
  type RateLimitInput,
  type RateLimitResult
} from './rate-limit.core';

export async function consumeRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  return consumeRateLimitWithDb(getDb(), input);
}

export async function clearRateLimit(input: Pick<RateLimitInput, 'scope' | 'key' | 'secret'>): Promise<void> {
  return clearRateLimitWithDb(getDb(), input);
}
