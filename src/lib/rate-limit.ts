import { createAdminClient } from "@/lib/supabase/admin";

// ────────────────────────────────────────────────────────────
// Rate limiting that survives serverless
// ────────────────────────────────────────────────────────────
// An in-memory Map only counts the requests that happen to land on the same
// warm instance, so on Vercel it barely limits anything. DbRateLimiter keeps
// the counts in Postgres instead (rate_limit_hits + rate_limit_hit(),
// migration 280), shared by every instance.
//
// FAIL OPEN, ON PURPOSE. A limiter error (migration not applied yet,
// database hiccup) must never shut a door or block an applicant. The shared
// limiter falls back to per-instance memory and logs once; if even that
// throws, the request is allowed. That means while migration 280 is
// missing, limiting is no better than before.
//
// Keys are SHA-256 hashed before they reach the database: they contain door
// tokens and client IP addresses, and the table only needs to tell keys apart.
// ────────────────────────────────────────────────────────────

export type RateLimitOptions = { limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

export interface RateLimiter {
  hit(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
}

// Fixed windows aligned to the epoch, the same arithmetic as the SQL
// function, so both limiters agree on when a window resets.
function windowStartMs(nowMs: number, windowSeconds: number) {
  const size = windowSeconds * 1000;
  return Math.floor(nowMs / size) * size;
}

// ── Per-instance fallback ────────────────────────────────────

export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    // Bounds memory if something sprays unique keys at one instance.
    private readonly maxKeys = 10_000
  ) {}

  async hit(key: string, { limit, windowSeconds }: RateLimitOptions): Promise<RateLimitResult> {
    const now = this.now();
    let entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      if (!entry && this.hits.size >= this.maxKeys) this.prune(now);
      entry = { count: 0, resetAt: windowStartMs(now, windowSeconds) + windowSeconds * 1000 };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(limit - entry.count, 0),
      resetAt: new Date(entry.resetAt),
    };
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
    // Still full of live keys: drop the oldest-inserted half.
    if (this.hits.size >= this.maxKeys) {
      let drop = Math.ceil(this.hits.size / 2);
      for (const k of this.hits.keys()) {
        if (drop-- <= 0) break;
        this.hits.delete(k);
      }
    }
  }
}

// ── Shared, in Postgres ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export class RateLimiterUnavailableError extends Error {}

export async function hashRateLimitKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class DbRateLimiter implements RateLimiter {
  private client: Client | null = null;

  // Service-role client: rate_limit_hit() is executable by service_role only.
  // Built on first use, so a missing env var surfaces as a limiter error
  // (and the fallback) rather than a crash in the route.
  constructor(private readonly makeClient: () => Client) {}

  async hit(key: string, { limit, windowSeconds }: RateLimitOptions): Promise<RateLimitResult> {
    this.client ??= this.makeClient();
    const { data, error } = await this.client.rpc("rate_limit_hit", {
      p_key: await hashRateLimitKey(key),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new RateLimiterUnavailableError(error.message ?? "rate_limit_hit failed");
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") {
      throw new RateLimiterUnavailableError("rate_limit_hit returned no row");
    }
    return {
      allowed: row.allowed,
      remaining: Number(row.remaining ?? 0),
      resetAt: new Date(row.reset_at),
    };
  }
}

// ── Primary with fallback ────────────────────────────────────

const ALLOW_ALL: RateLimitResult = { allowed: true, remaining: 0, resetAt: new Date(0) };

export class FallbackRateLimiter implements RateLimiter {
  private warned = false;
  private primaryDownUntil = 0;

  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
    private readonly options: {
      log?: (message: string) => void;
      now?: () => number;
      // After a primary failure, use the fallback for this long before
      // trying the database again (saves a failing round trip per request).
      retryAfterMs?: number;
    } = {}
  ) {}

  async hit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
    const now = this.options.now?.() ?? Date.now();
    if (now >= this.primaryDownUntil) {
      try {
        return await this.primary.hit(key, opts);
      } catch (err) {
        this.primaryDownUntil = now + (this.options.retryAfterMs ?? 60_000);
        if (!this.warned) {
          this.warned = true;
          (this.options.log ?? console.warn)(
            `[rate-limit] shared limiter unavailable, using per-instance memory (is migration 280 applied?): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }
    try {
      return await this.fallback.hit(key, opts);
    } catch {
      return { ...ALLOW_ALL, resetAt: new Date(now) };
    }
  }
}

let shared: RateLimiter | null = null;

/** The app-wide limiter: Postgres, falling back to memory. Server-only. */
export function getRateLimiter(): RateLimiter {
  shared ??= new FallbackRateLimiter(
    new DbRateLimiter(createAdminClient),
    new InMemoryRateLimiter()
  );
  return shared;
}

/**
 * The caller's IP, for keys. On Vercel x-forwarded-for is set by the
 * platform, so its first entry is the client.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** A 429 Retry-After value in whole seconds (at least 1). */
export function retryAfterSeconds(result: RateLimitResult, now = Date.now()): number {
  return Math.max(1, Math.ceil((result.resetAt.getTime() - now) / 1000));
}
