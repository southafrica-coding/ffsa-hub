import {
  BASE_DELAY_MS,
  backoffMs,
  isRetryableStatus,
  jitter,
  MAX_DELAY_MS,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  retryDelayMs,
} from "../backoff";

describe("backoff", () => {
  it("doubles from 2s and caps at 5 minutes", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(backoffMs(0)).toBe(BASE_DELAY_MS);
    expect(backoffMs(30)).toBe(MAX_DELAY_MS);
  });

  it("jitter stays between half and all of the delay", () => {
    expect(jitter(10_000, 0)).toBe(5_000);
    expect(jitter(10_000, 0.5)).toBe(7_500);
    expect(jitter(10_000)).toBe(10_000);
    // Out-of-range randoms are clamped, never negative or larger.
    expect(jitter(10_000, -3)).toBe(5_000);
    expect(jitter(10_000, 7)).toBe(10_000);
  });

  it("reads Retry-After as seconds or an HTTP date, capped, never negative", () => {
    const now = Date.parse("2026-11-03T10:00:00Z");
    expect(parseRetryAfter("20", now)).toBe(20_000);
    expect(parseRetryAfter(" 0 ", now)).toBe(0);
    expect(parseRetryAfter("Tue, 03 Nov 2026 10:01:00 GMT", now)).toBe(60_000);
    expect(parseRetryAfter("Tue, 03 Nov 2026 09:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("999999", now)).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it("waits at least as long as the server asks", () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(1, { retryAfterMs: 30_000 })).toBe(30_000);
    expect(retryDelayMs(10, { retryAfterMs: 1_000 })).toBe(MAX_DELAY_MS);
    expect(retryDelayMs(3, { random: 0 })).toBe(4_000);
  });

  it("knows which statuses are worth retrying by themselves", () => {
    expect([408, 425, 429, 500, 502, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 413, 422].some(isRetryableStatus)).toBe(false);
    expect(isRetryableStatus(undefined)).toBe(true);
  });
});
