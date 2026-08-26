import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Recovery codes for two-factor authentication.
 *
 * We generate them, show them to the user exactly once, and keep only SHA-256
 * hashes. There is no way — for us, for an admin, or for anyone with the
 * database — to read a code back out.
 *
 * A plain hash (rather than bcrypt/argon) is the right call here: unlike a
 * password these are 50 bits of cryptographically random entropy with no reuse
 * across sites, so there is nothing to brute-force offline and nothing to
 * dictionary-attack. Online guessing is stopped by rate limiting instead.
 */

export const RECOVERY_CODE_COUNT = 10;

// Crockford-style alphabet: no 0/O/1/I/L/U, so a hand-copied code can't be
// mistyped into a different valid-looking one.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const GROUP_LENGTH = 5;

function randomGroup(): string {
  // Rejection-sample so every character is uniformly distributed. 30 does not
  // divide 256 evenly, so a naive modulo would bias the first few letters.
  const out: string[] = [];
  while (out.length < GROUP_LENGTH) {
    for (const byte of randomBytes(GROUP_LENGTH)) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === GROUP_LENGTH) break;
    }
  }
  return out.join("");
}

/** A single display-formatted code, e.g. "K7RQ2-9WXMD". */
export function generateRecoveryCode(): string {
  return `${randomGroup()}-${randomGroup()}`;
}

/** A fresh set of codes, in the plaintext form shown to the user once. */
export function generateRecoveryCodes(
  count: number = RECOVERY_CODE_COUNT
): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/**
 * Strip formatting so a user can type "k7rq2 9wxmd", "K7RQ29WXMD" or paste the
 * code exactly as displayed and all three match.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(input: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(input)).digest("hex");
}

/** Constant-time hash comparison, so a match can't be timed out character by character. */
export function recoveryCodeHashMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** True if the input could be a code at all — cheap guard before hitting the DB. */
export function looksLikeRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input).length === GROUP_LENGTH * 2;
}

export type StoredRecoveryCode = {
  id: string;
  code_hash: string;
  used_at: string | null;
};

/**
 * Picks the row a submitted code redeems, or null.
 *
 * An already-spent code returns null exactly like an unknown one — the caller
 * gives the same message for both, so a user (or an attacker holding a stolen
 * list) learns nothing about which codes have been used.
 */
export function selectRedeemableCode(
  rows: StoredRecoveryCode[],
  submitted: string
): StoredRecoveryCode | null {
  if (!looksLikeRecoveryCode(submitted)) return null;
  const submittedHash = hashRecoveryCode(submitted);
  const match = rows.find((row) =>
    recoveryCodeHashMatches(row.code_hash, submittedHash)
  );
  if (!match || match.used_at) return null;
  return match;
}
