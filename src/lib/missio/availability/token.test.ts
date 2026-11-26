import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  AVAILABILITY_TOKEN_HASH_PATTERN,
  AVAILABILITY_TOKEN_PATTERN,
  AVAILABILITY_TOKEN_SECRET_MIN_LENGTH,
  AVAILABILITY_TOKEN_SECRET_PLACEHOLDER,
  AvailabilityTokenSecretError,
  deriveAvailabilityToken,
  hashAvailabilityToken,
  issuedAvailabilityToken,
  newAvailabilityNonce,
  personalAvailabilityUrl,
  requireAvailabilityTokenSecret,
  verifyAvailabilityToken,
} from "./token";

const secret = "test-secret";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const contactId = "11111111-1111-4111-8111-111111111111";

describe("derived availability tokens", () => {
  it("rebuilds the same link from the secret, ids, and nonce", () => {
    const nonce = newAvailabilityNonce();
    const first = deriveAvailabilityToken({ secret, requestId, contactId, nonce });
    const second = deriveAvailabilityToken({ secret, requestId, contactId, nonce });
    expect(first).toBe(second);
    expect(first).toMatch(AVAILABILITY_TOKEN_PATTERN);
  });

  it("stores the nonce and a hash, not the raw token", () => {
    const issued = issuedAvailabilityToken({ secret, requestId, contactId });
    expect(issued.nonce).toMatch(AVAILABILITY_TOKEN_PATTERN);
    expect(issued.token_hash).toMatch(AVAILABILITY_TOKEN_HASH_PATTERN);
    expect(issued.token_hash).toBe(hashAvailabilityToken(issued.raw));
    const stored = { nonce: issued.nonce, token_hash: issued.token_hash };
    expect(JSON.stringify(stored)).not.toContain(issued.raw);
    expect(stored).not.toHaveProperty("token");
    expect(verifyAvailabilityToken(issued.raw, issued.token_hash)).toBe(true);
  });

  it("changes the link when the nonce rotates and keeps the old hash from matching", () => {
    const first = issuedAvailabilityToken({ secret, requestId, contactId });
    const rotated = issuedAvailabilityToken({ secret, requestId, contactId });
    expect(rotated.raw).not.toBe(first.raw);
    expect(verifyAvailabilityToken(first.raw, rotated.token_hash)).toBe(false);
    expect(verifyAvailabilityToken(rotated.raw, first.token_hash)).toBe(false);
  });

  it("fails closed when the secret is missing, short, or the example placeholder", () => {
    const previous = process.env.MISSIO_AVAILABILITY_TOKEN_SECRET;
    const placeholder = readFileSync(path.resolve(__dirname, "../../../../.env.example"), "utf8")
      .match(/^MISSIO_AVAILABILITY_TOKEN_SECRET=(.*)$/m)?.[1]
      ?.trim();
    expect(placeholder).toBe(AVAILABILITY_TOKEN_SECRET_PLACEHOLDER);

    delete process.env.MISSIO_AVAILABILITY_TOKEN_SECRET;
    expect(() => requireAvailabilityTokenSecret()).toThrow(AvailabilityTokenSecretError);

    process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = "x".repeat(AVAILABILITY_TOKEN_SECRET_MIN_LENGTH - 1);
    expect(() => requireAvailabilityTokenSecret()).toThrow(AvailabilityTokenSecretError);

    process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = AVAILABILITY_TOKEN_SECRET_PLACEHOLDER;
    expect(() => requireAvailabilityTokenSecret()).toThrow(AvailabilityTokenSecretError);

    process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = "x".repeat(AVAILABILITY_TOKEN_SECRET_MIN_LENGTH);
    expect(requireAvailabilityTokenSecret()).toBe("x".repeat(AVAILABILITY_TOKEN_SECRET_MIN_LENGTH));

    if (previous == null) delete process.env.MISSIO_AVAILABILITY_TOKEN_SECRET;
    else process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = previous;
  });

  it("builds the personal link without putting the hash in the path", () => {
    const issued = issuedAvailabilityToken({ secret, requestId, contactId });
    const url = personalAvailabilityUrl("https://hub.example.org/", issued.raw);
    expect(url).toBe(`https://hub.example.org/serve/missio/${issued.raw}`);
    expect(url).not.toContain(issued.token_hash);
  });
});
