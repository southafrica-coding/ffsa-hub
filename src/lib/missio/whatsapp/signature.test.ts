import { createHmac } from "node:crypto";
import * as crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyHandshake, verifyMetaSignature } from "./signature";

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});

const SECRET = "test-app-secret-not-real";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [] }] });
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

describe("verifyMetaSignature", () => {
  it("accepts the HMAC of the exact raw body, in either hex case", () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyMetaSignature(body, sign(body).toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(true);
  });

  it("compares with timingSafeEqual", () => {
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();
    verifyMetaSignature(body, sign(body), SECRET);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses a signature made with another secret", () => {
    expect(verifyMetaSignature(body, sign(body, "someone-else"), SECRET)).toBe(false);
  });

  it("refuses a missing or malformed header", () => {
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body).slice("sha256=".length), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=" + sign(body).slice(7), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body).slice(0, -2), SECRET)).toBe(false);
  });

  it("refuses a body that was cut short or changed after signing", () => {
    const header = sign(body);
    expect(verifyMetaSignature(body.slice(0, -1), header, SECRET)).toBe(false);
    expect(verifyMetaSignature(body.replace("whatsapp", "whatsApp"), header, SECRET)).toBe(false);
    expect(verifyMetaSignature(`${body} `, header, SECRET)).toBe(false);
  });

  it("refuses everything when no secret is set", () => {
    expect(verifyMetaSignature(body, sign(body, ""), "")).toBe(false);
  });
});

describe("verifyHandshake", () => {
  const params = (p: Record<string, string>) => new URLSearchParams(p);

  it("echoes the challenge for the right token", () => {
    expect(verifyHandshake(params({ "hub.mode": "subscribe", "hub.verify_token": "tok-123", "hub.challenge": "98765" }), "tok-123")).toEqual({
      ok: true,
      challenge: "98765",
    });
  });

  it("refuses a wrong token, even one of a different length", () => {
    expect(verifyHandshake(params({ "hub.mode": "subscribe", "hub.verify_token": "tok-124", "hub.challenge": "1" }), "tok-123").ok).toBe(false);
    expect(verifyHandshake(params({ "hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "1" }), "tok-123").ok).toBe(false);
    expect(verifyHandshake(params({ "hub.mode": "subscribe", "hub.challenge": "1" }), "tok-123").ok).toBe(false);
  });

  it("refuses the wrong mode, no challenge, or no configured token", () => {
    expect(verifyHandshake(params({ "hub.mode": "unsubscribe", "hub.verify_token": "tok-123", "hub.challenge": "1" }), "tok-123").ok).toBe(false);
    expect(verifyHandshake(params({ "hub.mode": "subscribe", "hub.verify_token": "tok-123" }), "tok-123").ok).toBe(false);
    expect(verifyHandshake(params({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), "").ok).toBe(false);
  });
});
