// The shared request helpers (apiFetch, bookingsFetch) turn every refusal
// into an ApiError without the response headers, so a server's Retry-After
// would be lost. This wraps the `fetch` they call and remembers the last
// Retry-After seen on a 429 / 503. An outbox sends one item at a time, so
// "the last one" is the answer to the request that just failed.

import { parseRetryAfter } from "./backoff";

export type RetryAfterRecorder = {
  fetchImpl: typeof fetch;
  /** The Retry-After (ms) of the last 429/503 since the previous take(), then forgets it. */
  take(): number | null;
};

export function retryAfterRecorder(base: typeof fetch = (...args) => fetch(...args), now: () => number = Date.now): RetryAfterRecorder {
  let last: number | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    last = null;
    const res = await base(input, init);
    if (res.status === 429 || res.status === 503) last = parseRetryAfter(res.headers.get("retry-after"), now());
    return res;
  };
  return {
    fetchImpl,
    take() {
      const v = last;
      last = null;
      return v;
    },
  };
}
