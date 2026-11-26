import { describe, expect, it } from "vitest";
import { pageUrl, PAGE_URL_TTL_SECONDS, PREVIEW_VIEWER, verifyPageQuery } from "../signing";

const KEY = "test-key-at-least-sixteen";
const ASSET = "11111111-1111-4111-8111-111111111111";
const T0 = Date.UTC(2026, 10, 26, 10, 0, 0);
const parse = (url: string) => new URL(url, "https://store.test").searchParams;

describe("signed page URLs", () => {
  it("verify inside the window and name the viewer", () => {
    const url = pageUrl({ assetId: ASSET, page: 3, viewer: "Reader@Example.org" }, { now: T0, key: KEY });
    const v = verifyPageQuery(parse(url), { now: T0 + 60_000, key: KEY });
    expect(v).toEqual({ ok: true, claim: { assetId: ASSET, page: 3, viewer: "reader@example.org", expiresAt: T0 / 1000 + PAGE_URL_TTL_SECONDS } });
  });

  it("expire after the TTL", () => {
    const url = pageUrl({ assetId: ASSET, page: 1, viewer: "r@example.org" }, { now: T0, key: KEY });
    expect(verifyPageQuery(parse(url), { now: T0 + PAGE_URL_TTL_SECONDS * 1000, key: KEY }).ok).toBe(true);
    expect(verifyPageQuery(parse(url), { now: T0 + (PAGE_URL_TTL_SECONDS + 1) * 1000, key: KEY })).toEqual({ ok: false, reason: "expired" });
    expect(PAGE_URL_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
  });

  it("can't be edited: another page, another viewer (preview → paid page), or a later expiry", () => {
    const q = parse(pageUrl({ assetId: ASSET, page: 1, viewer: "r@example.org" }, { now: T0, key: KEY }));
    for (const [k, v] of [["p", "2"], ["v", PREVIEW_VIEWER], ["v", "someone@example.org"], ["e", String(T0 / 1000 + 99999)], ["a", "22222222-2222-4222-8222-222222222222"]]) {
      const edited = new URLSearchParams(q);
      edited.set(k, v);
      expect(verifyPageQuery(edited, { now: T0, key: KEY })).toEqual({ ok: false, reason: "bad-signature" });
    }
    expect(verifyPageQuery(q, { now: T0, key: "a-different-secret-key" }).ok).toBe(false);
  });

  it("rejects malformed queries", () => {
    expect(verifyPageQuery(new URLSearchParams("a=x&p=1&v=a&e=1&s=z"), { key: KEY })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyPageQuery(new URLSearchParams(""), { key: KEY }).ok).toBe(false);
  });
});
