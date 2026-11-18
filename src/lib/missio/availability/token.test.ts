import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_TOKEN_HASH_PATTERN,
  AVAILABILITY_TOKEN_PATTERN,
  generateAvailabilityToken,
  hashAvailabilityToken,
  personalAvailabilityUrl,
  tokenHashRecord,
  verifyAvailabilityToken,
} from "./token";

describe("availability tokens", () => {
  it("stores a sha256 hex digest and not the raw token", () => {
    const { raw, tokenHash } = generateAvailabilityToken();
    expect(raw).toMatch(AVAILABILITY_TOKEN_PATTERN);
    expect(tokenHash).toMatch(AVAILABILITY_TOKEN_HASH_PATTERN);
    expect(tokenHash).not.toBe(raw);
    expect(tokenHash).toBe(hashAvailabilityToken(raw));

    const record = tokenHashRecord(raw, "2026-11-23T22:00:00.000Z");
    expect(record).toEqual({ token_hash: tokenHash, expires_at: "2026-11-23T22:00:00.000Z" });
    expect(JSON.stringify(record)).not.toContain(raw);
    expect(record).not.toHaveProperty("token");
  });

  it("verifies the raw token against the stored hash", () => {
    const { raw, tokenHash } = generateAvailabilityToken();
    const tampered = `${raw.slice(0, 42)}${raw.endsWith("a") ? "b" : "a"}`;
    const flipped = `${tokenHash[0] === "0" ? "1" : "0"}${tokenHash.slice(1)}`;
    expect(verifyAvailabilityToken(raw, tokenHash)).toBe(true);
    expect(verifyAvailabilityToken(tampered, tokenHash)).toBe(false);
    expect(verifyAvailabilityToken(raw, flipped)).toBe(false);
  });

  it("rejects a raw value that was stored in place of a hash", () => {
    const { raw } = generateAvailabilityToken();
    expect(verifyAvailabilityToken(raw, raw)).toBe(false);
    expect(AVAILABILITY_TOKEN_HASH_PATTERN.test(raw)).toBe(false);
  });

  it("builds the personal link without putting the hash in the path", () => {
    const { raw, tokenHash } = generateAvailabilityToken();
    const url = personalAvailabilityUrl("https://hub.example.org/", raw);
    expect(url).toBe(`https://hub.example.org/serve/missio/${raw}`);
    expect(url).not.toContain(tokenHash);
  });

  it("hashes the same raw token the same way every time", () => {
    const raw = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(hashAvailabilityToken(raw)).toBe(hashAvailabilityToken(raw));
    expect(hashAvailabilityToken(raw)).not.toBe(hashAvailabilityToken(`${raw.slice(0, 42)}b`));
  });
});
