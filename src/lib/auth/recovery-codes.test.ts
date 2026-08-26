import { describe, it, expect } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
  recoveryCodeHashMatches,
  looksLikeRecoveryCode,
  selectRedeemableCode,
} from "./recovery-codes";

describe("recovery codes", () => {
  it("generates the expected count, all unique", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("formats codes as two five-character groups", () => {
    expect(generateRecoveryCode()).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  it("never emits ambiguous characters", () => {
    const joined = generateRecoveryCodes(50).join("");
    expect(joined).not.toMatch(/[01OILU]/);
  });

  it("normalises spacing, case and separators to the same value", () => {
    const code = generateRecoveryCode();
    const [a, b] = code.split("-");
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(normalizeRecoveryCode(code));
    expect(normalizeRecoveryCode(`${a} ${b}`)).toBe(normalizeRecoveryCode(code));
    expect(normalizeRecoveryCode(`  ${a}${b}  `)).toBe(normalizeRecoveryCode(code));
  });

  it("hashes equal codes to the same digest and different codes apart", () => {
    const code = generateRecoveryCode();
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code.toLowerCase()));
    expect(hashRecoveryCode(code)).not.toBe(hashRecoveryCode(generateRecoveryCode()));
    expect(hashRecoveryCode(code)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never returns the plaintext code inside its own hash", () => {
    const code = generateRecoveryCode();
    expect(hashRecoveryCode(code)).not.toContain(normalizeRecoveryCode(code));
  });

  it("compares hashes safely", () => {
    const h = hashRecoveryCode("ABCDE-FGHJK");
    expect(recoveryCodeHashMatches(h, h)).toBe(true);
    expect(recoveryCodeHashMatches(h, hashRecoveryCode("KJHGF-EDCBA"))).toBe(false);
    expect(recoveryCodeHashMatches(h, "short")).toBe(false);
  });

  it("rejects malformed input before a database lookup", () => {
    expect(looksLikeRecoveryCode(generateRecoveryCode())).toBe(true);
    expect(looksLikeRecoveryCode("123")).toBe(false);
    expect(looksLikeRecoveryCode("")).toBe(false);
    expect(looksLikeRecoveryCode("A".repeat(40))).toBe(false);
  });
});

describe("selectRedeemableCode", () => {
  function store(codes: string[]) {
    return codes.map((code, i) => ({
      id: `row-${i}`,
      code_hash: hashRecoveryCode(code),
      used_at: null as string | null,
    }));
  }

  it("redeems a valid, unused code", () => {
    const codes = generateRecoveryCodes();
    const rows = store(codes);
    expect(selectRedeemableCode(rows, codes[3])?.id).toBe("row-3");
  });

  it("accepts the code however the user typed it", () => {
    const codes = generateRecoveryCodes();
    const rows = store(codes);
    const [a, b] = codes[0].split("-");
    expect(selectRedeemableCode(rows, codes[0].toLowerCase())?.id).toBe("row-0");
    expect(selectRedeemableCode(rows, `${a} ${b}`)?.id).toBe("row-0");
  });

  it("refuses a code that has already been used once", () => {
    const codes = generateRecoveryCodes();
    const rows = store(codes);
    expect(selectRedeemableCode(rows, codes[0])).not.toBeNull();

    // ...the route stamps used_at, and the same code is dead from then on.
    rows[0].used_at = "2026-08-26T10:00:00.000Z";
    expect(selectRedeemableCode(rows, codes[0])).toBeNull();
    // Its siblings are untouched.
    expect(selectRedeemableCode(rows, codes[1])).not.toBeNull();
  });

  it("refuses a code that was never issued", () => {
    const rows = store(generateRecoveryCodes());
    expect(selectRedeemableCode(rows, generateRecoveryCode())).toBeNull();
  });

  it("refuses malformed input and an empty store", () => {
    const codes = generateRecoveryCodes();
    expect(selectRedeemableCode(store(codes), "nope")).toBeNull();
    expect(selectRedeemableCode(store(codes), "")).toBeNull();
    expect(selectRedeemableCode([], codes[0])).toBeNull();
  });

  it("treats a regenerated set as a clean break from the old one", () => {
    const oldCodes = generateRecoveryCodes();
    const newRows = store(generateRecoveryCodes());
    // Regeneration deletes the old rows, so nothing from the old set matches.
    for (const code of oldCodes) {
      expect(selectRedeemableCode(newRows, code)).toBeNull();
    }
  });
});
