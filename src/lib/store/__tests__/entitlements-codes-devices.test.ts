import { describe, expect, it } from "vitest";
import { accessFor, isEntitlementActive } from "../entitlements";
import { CODE_ALPHABET, generateCode, normaliseCode } from "../codes";
import { deviceLabel, hashDeviceId } from "../devices";
import { STORE_DEVICE_LIMIT } from "../flags";
import { createMemoryDb, storeRpcs } from "../testing/memory-db";
import { IDS, review } from "../testing/fixtures";
import { isDeviceActive, listDevices, redeemCode, registerDevice, removeDevice } from "@/services/store";
import type { StoreEntitlement } from "../types";

const NOW = new Date("2026-11-26T10:00:00Z");
const ent = (extra: Partial<StoreEntitlement>): StoreEntitlement => ({
  id: "e",
  product_id: IDS.review,
  email: "reader@example.org",
  user_id: null,
  source: "purchase",
  order_item_id: null,
  code_id: null,
  includes_pdf: false,
  starts_at: "2026-01-01T00:00:00Z",
  expires_at: null,
  revoked_at: null,
  ...extra,
});

describe("entitlements", () => {
  it("is active between start and expiry, unless revoked", () => {
    expect(isEntitlementActive(ent({}), NOW)).toBe(true);
    expect(isEntitlementActive(ent({ expires_at: "2026-11-01T00:00:00Z" }), NOW)).toBe(false);
    expect(isEntitlementActive(ent({ revoked_at: "2026-06-01T00:00:00Z" }), NOW)).toBe(false);
    expect(isEntitlementActive(ent({ starts_at: "2027-01-01T00:00:00Z" }), NOW)).toBe(false);
  });

  it("matches by email or by signed-in user, per product", () => {
    const list = [ent({ email: "reader@example.org" }), ent({ email: "other@example.org", user_id: "u-2", product_id: IDS.sub })];
    expect(accessFor(list, { userId: null, email: "READER@example.org" }, IDS.review, NOW).read).toBe(true);
    expect(accessFor(list, { userId: "u-2", email: "new-address@example.org" }, IDS.sub, NOW).read).toBe(true);
    expect(accessFor(list, { userId: "u-3", email: "stranger@example.org" }, IDS.review, NOW).read).toBe(false);
    expect(accessFor(list, { userId: null, email: "reader@example.org" }, IDS.sub, NOW).read).toBe(false);
  });

  it("only a Print + Digital entitlement unlocks the PDF; digital and subscription stay flipbook-only", () => {
    const who = { userId: null, email: "reader@example.org" };
    expect(accessFor([ent({})], who, IDS.review, NOW)).toEqual({ read: true, pdf: false, expiresAt: null });
    expect(accessFor([ent({ product_id: IDS.sub, expires_at: "2027-11-26T10:00:00Z" })], who, IDS.sub, NOW)).toEqual({ read: true, pdf: false, expiresAt: "2027-11-26T10:00:00Z" });
    expect(accessFor([ent({ product_id: IDS.bundle, includes_pdf: true })], who, IDS.bundle, NOW).pdf).toBe(true);
  });
});

describe("gift and pack codes", () => {
  it("are 12 characters from an alphabet without 0, O, 1 or I", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
    for (let i = 0; i < 100; i++) expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("forgive case, spaces and missing dashes, and reject what can't be a code", () => {
    expect(normaliseCode(" abcd efgh jk23 ")).toBe("ABCD-EFGH-JK23");
    expect(normaliseCode("ABCDEFGHJK23")).toBe("ABCD-EFGH-JK23");
    expect(normaliseCode("ABCD-EFGH-JK2")).toBeNull();
    expect(normaliseCode("ABCD-EFGH-JK20")).toBeNull(); // 0 isn't in the alphabet
  });

  it("redeem once: the first claim grants, a second is refused", async () => {
    const db = createMemoryDb({
      store_codes: [{ id: "c1", code: "ABCD-EFGH-JK23", kind: "gift", product_id: IDS.review, order_item_id: "i1", recipient_email: "friend@example.org", includes_pdf: false, redeemed_at: null }],
    });
    const input = { codeId: "c1", email: "friend@example.org", userId: null, kind: "gift" as const, entitlement: { product_id: review.id, includes_pdf: false, starts_at: NOW.toISOString(), expires_at: null } };
    const first = await redeemCode(db.client, input);
    expect(first.error).toBeNull();
    expect(db.table("store_entitlements")).toEqual([expect.objectContaining({ email: "friend@example.org", source: "gift", code_id: "c1" })]);
    const second = await redeemCode(db.client, { ...input, email: "someone-else@example.org" });
    expect(second.error).toEqual({ message: "already-redeemed" });
    expect(db.table("store_entitlements")).toHaveLength(1);
  });
});

describe("reading devices", () => {
  it("hashes only well-formed device ids", () => {
    expect(hashDeviceId("short")).toBeNull();
    expect(hashDeviceId("x".repeat(20) + "<script>")).toBeNull();
    const h = hashDeviceId("abcdefghijklmnopqrstuvwxyz012345");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("abcdefghijklmnop");
  });

  it(`allows ${STORE_DEVICE_LIMIT} active devices, the same device again, and a new one after removing`, async () => {
    const db = createMemoryDb({}, { rpc: storeRpcs });
    const reg = (d: string) => registerDevice(db.client, { userId: "u1", deviceHash: d, label: "Test", limit: STORE_DEVICE_LIMIT });
    expect((await reg("h1")).data).toBe("ok");
    expect((await reg("h2")).data).toBe("ok");
    expect((await reg("h3")).data).toBe("ok");
    expect((await reg("h4")).data).toBe("limit");
    expect((await reg("h2")).data).toBe("ok"); // returning device
    expect((await isDeviceActive(db.client, "u1", "h4")).data).toBe(false);

    const { data: list } = await listDevices(db.client, "u1");
    const removed = await removeDevice(db.client, "u1", list[0].id);
    expect(removed.data).toBeTruthy();
    expect((await reg("h4")).data).toBe("ok");
    // Someone else's limit is their own; and nobody removes another's device.
    expect((await registerDevice(db.client, { userId: "u2", deviceHash: "h1", label: "x", limit: 3 })).data).toBe("ok");
    const { data: theirs } = await listDevices(db.client, "u2");
    expect((await removeDevice(db.client, "u1", theirs[0].id)).data).toBeNull();
  });

  it("labels devices plainly", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceLabel(null)).toBe("A browser");
  });
});
