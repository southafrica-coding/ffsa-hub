import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Match tokens and search-audit hashes are HMAC-SHA256. The key is derived
// from SUPABASE_SERVICE_ROLE_KEY, which the app already requires to open the
// service-role client. No new secret. Contact ids are visible on
// contact_labels, so an unsalted hash of the id could be guessed offline.

const SALT = "ffsa-hub";
const TOKEN_INFO = "missio-match-token-v1";
const AUDIT_INFO = "missio-audit-v1";
const CONNECT_RATE_INFO = "missio-connect-rate-v1";
const TOKEN_TTL_SECONDS = 15 * 60;

function baseSecret(): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return secret && secret.length > 0 ? secret : null;
}

function derivedKey(info: string): Buffer | null {
  const secret = baseSecret();
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, SALT, info, 32));
}

function tokenPayload(args: {
  exp: number;
  userId: string;
  orgId: string;
  contactId: string;
  normalizedValue: string;
}): string {
  return `v1|${args.exp}|${args.userId}|${args.orgId}|${args.contactId}|${args.normalizedValue}`;
}

export function missioMatchToken(args: {
  userId: string;
  orgId: string;
  contactId: string;
  normalizedValue: string;
  nowSeconds?: number;
}): string | null {
  const key = derivedKey(TOKEN_INFO);
  if (!key) return null;
  const exp = (args.nowSeconds ?? Math.floor(Date.now() / 1000)) + TOKEN_TTL_SECONDS;
  const mac = createHmac("sha256", key).update(tokenPayload({ ...args, exp })).digest("base64url");
  return `v1.${exp}.${mac}`;
}

/** HMAC of a normalised query. Null when the service-role key is missing. */
export function queryHmac(normalizedQuery: string): string | null {
  const key = derivedKey(AUDIT_INFO);
  if (!key) return null;
  return createHmac("sha256", key).update(normalizedQuery).digest("base64url");
}

/**
 * HMAC of a client IP (or device id) for connect_responses.rate_key_hash.
 * Same service-role key as match tokens. Null when that key is missing.
 * Never persist the raw IP.
 */
export function connectRateKeyHash(ip: string): string | null {
  const key = derivedKey(CONNECT_RATE_INFO);
  if (!key) return null;
  return createHmac("sha256", key).update(ip).digest("base64url");
}

export function matchTokenFits(args: {
  token: string;
  userId: string;
  orgId: string;
  contactId: string;
  normalizedValue: string;
  nowSeconds?: number;
}): boolean | "missing_secret" {
  const key = derivedKey(TOKEN_INFO);
  if (!key) return "missing_secret";
  const parts = args.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  const mac = parts[2] ?? "";
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(exp) || exp <= now) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(mac)) return false;
  const expected = createHmac("sha256", key)
    .update(tokenPayload({ exp, userId: args.userId, orgId: args.orgId, contactId: args.contactId, normalizedValue: args.normalizedValue }))
    .digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
