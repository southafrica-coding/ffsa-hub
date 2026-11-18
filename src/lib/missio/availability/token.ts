import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 base64url, no padding. The only shape a personal link may carry. */
export const AVAILABILITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** SHA-256 hex of the raw link. This, plus the nonce, is all that is stored. */
export const AVAILABILITY_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export const AVAILABILITY_TOKEN_SECRET_ENV = "MISSIO_AVAILABILITY_TOKEN_SECRET";

export class AvailabilityTokenSecretError extends Error {
  constructor() {
    super(`${AVAILABILITY_TOKEN_SECRET_ENV} is not set`);
    this.name = "AvailabilityTokenSecretError";
  }
}

export function requireAvailabilityTokenSecret(): string {
  const secret = process.env[AVAILABILITY_TOKEN_SECRET_ENV]?.trim();
  if (!secret) throw new AvailabilityTokenSecretError();
  return secret;
}

export function hashAvailabilityToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function newAvailabilityNonce(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Raw link token. The server can rebuild it from the secret, the request,
 * the contact, and the stored nonce. The raw value is not written down.
 */
export function deriveAvailabilityToken(args: {
  secret: string;
  requestId: string;
  contactId: string;
  nonce: string;
}): string {
  return createHmac("sha256", args.secret)
    .update(`${args.requestId}|${args.contactId}|${args.nonce}`)
    .digest("base64url");
}

/** Columns written for a link. `raw` is returned to the pastor once and is not a column. */
export function issuedAvailabilityToken(args: {
  secret: string;
  requestId: string;
  contactId: string;
  nonce?: string;
}): { raw: string; nonce: string; token_hash: string } {
  const nonce = args.nonce ?? newAvailabilityNonce();
  const raw = deriveAvailabilityToken({ ...args, nonce });
  return { raw, nonce, token_hash: hashAvailabilityToken(raw) };
}

/** True only when `raw` hashes to the stored hex digest. */
export function verifyAvailabilityToken(raw: string, tokenHash: string): boolean {
  if (!AVAILABILITY_TOKEN_PATTERN.test(raw)) return false;
  if (!AVAILABILITY_TOKEN_HASH_PATTERN.test(tokenHash)) return false;
  const computed = hashAvailabilityToken(raw);
  return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(tokenHash, "utf8"));
}

export function personalAvailabilityUrl(origin: string, raw: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/serve/missio/${raw}`;
}
