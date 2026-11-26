// Gift and pack codes: XXXX-XXXX-XXXX from an alphabet with no 0/O/1/I,
// so a code read aloud or copied off paper can't be mistyped that way.
import { randomInt } from "node:crypto";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(pick: (max: number) => number = randomInt): string {
  const block = () => Array.from({ length: 4 }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}

/** Forgiving input (lower case, spaces, missing dashes). Null if it can't be a code. */
export function normaliseCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, "");
  if (raw.length !== 12 || ![...raw].every((c) => CODE_ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
