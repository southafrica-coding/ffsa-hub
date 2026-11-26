import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, storeRpcs, type MemoryDb } from "../testing/memory-db";
import { buyerFromAuthUser } from "../access";
import { STORE_DEVICE_LIMIT } from "../flags";
import { canActOnOrder, signOrderToken, thanksPath, verifyOrderToken } from "../signing";
import { isDeviceActive, listDevices, registerDevice, removeDevice } from "@/services/store";

vi.mock("server-only", () => ({}));

// Hub Review on PR #730: (1) a buyer JWT could UPDATE store_devices and
// clear removed_at, lifting the three-device cap; (2) the EFT proof upload
// took the bare order UUID as its key and upserted over any earlier proof;
// (3) buyers were trusted on an unconfirmed email. These tests pin the fixes.

// ────────────────────────────────────────────────────────────
// Table privileges, as 412 grants them
// ────────────────────────────────────────────────────────────
const root = path.resolve(__dirname, "../../../..");
const sql = readFileSync(path.join(root, "supabase/migrations/412_store.sql"), "utf8").replace(/--.*$/gm, "");
const TABLES = ["store_products", "store_variants", "store_assets", "store_asset_pages", "store_orders", "store_order_items", "store_entitlements", "store_codes", "store_devices", "store_fulfilments"];
const list = (s: string) => s.split(",").map((x) => x.trim().replace(/^public\./, "")).filter(Boolean);

/** Replay every GRANT / REVOKE ... ON TABLE in 412, in order. Starts from
 *  hosted Supabase's default: ALL to anon and authenticated. */
function tablePrivileges(): Record<string, Record<string, Set<string>>> {
  const ALL = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
  const priv: Record<string, Record<string, Set<string>>> = {};
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    priv[role] = Object.fromEntries(TABLES.map((t) => [t, new Set(role === "PUBLIC" ? [] : ALL)]));
  }
  const re = /\b(GRANT|REVOKE)\s+([A-Z, ]+?)\s+ON TABLE\s+([\s\S]+?)\s+(TO|FROM)\s+([\w, ]+);/g;
  for (const m of sql.matchAll(re)) {
    const privs = m[2].trim() === "ALL" ? ALL : list(m[2]);
    for (const role of list(m[5])) {
      for (const t of list(m[3])) {
        for (const p of privs) {
          if (m[1] === "GRANT") priv[role][t].add(p);
          else priv[role][t].delete(p);
        }
      }
    }
  }
  return priv;
}

/** A buyer's PostgREST client: the in-memory db, but refusing any command
 *  the `authenticated` role has no privilege for (42501), and scoping
 *  store_devices reads to their own rows (the "own read" policy). */
function buyerClient(db: MemoryDb, userId: string) {
  const priv = tablePrivileges().authenticated;
  return {
    from(table: string) {
      const inner = db.client.from(table);
      let action = "SELECT";
      const w: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "is", "or", "order", "limit", "single", "maybeSingle"]) {
        w[m] = (...a: unknown[]) => (inner[m](...a), w);
      }
      for (const [m, cmd] of [["insert", "INSERT"], ["update", "UPDATE"], ["delete", "DELETE"], ["upsert", "INSERT"]] as const) {
        w[m] = (...a: unknown[]) => ((action = cmd), inner[m](...a), w);
      }
      w.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        if (!priv[table]?.has(action)) {
          return Promise.resolve({ data: null, error: { code: "42501", message: `permission denied for table ${table}` } }).then(ok, bad);
        }
        if (table === "store_devices") inner.eq("user_id", userId);
        return inner.then(ok, bad);
      };
      return w as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    },
  };
}

describe("412 table privileges (pattern of 351_fleet_rls.sql)", () => {
  it("revokes ALL from PUBLIC, anon and authenticated on all ten tables before any GRANT", () => {
    const revoke = sql.match(/REVOKE ALL ON TABLE\s+([\s\S]+?)\s+FROM PUBLIC, anon, authenticated;/);
    expect(revoke).not.toBeNull();
    expect(list(revoke![1]).sort()).toEqual([...TABLES].sort());
    const firstGrant = sql.search(/GRANT [A-Z, ]+ ON TABLE/);
    expect(revoke!.index!).toBeLessThan(firstGrant);
  });

  it("buyers (authenticated) get SELECT only on devices, codes and order items; anon only the catalogue", () => {
    const p = tablePrivileges();
    expect([...p.authenticated.store_devices]).toEqual(["SELECT"]);
    expect([...p.authenticated.store_codes]).toEqual(["SELECT"]);
    expect([...p.authenticated.store_order_items]).toEqual(["SELECT"]);
    expect([...p.authenticated.store_orders].sort()).toEqual(["SELECT", "UPDATE"]);
    for (const t of TABLES) {
      expect([...p.anon[t]]).toEqual(["store_products", "store_variants"].includes(t) ? ["SELECT"] : []);
      expect([...p.PUBLIC[t]]).toEqual([]);
      expect(p.service_role[t].has("UPDATE")).toBe(true);
      expect(p.authenticated[t].has("TRUNCATE")).toBe(false);
    }
  });

  it("has no buyer write policy on store_devices", () => {
    const devicePolicies = [...sql.matchAll(/CREATE POLICY "[^"]+"\s+ON public\.store_devices FOR (\w+)/g)].map((m) => m[1]);
    expect(devicePolicies).toEqual(["SELECT"]);
  });

  it("every Store RPC revokes PUBLIC, anon and authenticated before granting service_role", () => {
    for (const sig of ["store_take_stock(uuid, integer)", "store_register_device(uuid, text, text, integer)", "store_remove_device(uuid, uuid)"]) {
      const esc = sig.replace(/[()]/g, "\\$&");
      const revoke = sql.search(new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc} FROM PUBLIC, anon, authenticated;`));
      const grant = sql.search(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc} TO service_role;`));
      expect(revoke).toBeGreaterThan(-1);
      expect(grant).toBeGreaterThan(revoke);
      expect(sql).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc} TO [^;]*(authenticated|anon)`));
    }
    for (const fn of ["store_can_manage()", "store_can_view()", "store_buyer_email()"]) {
      const esc = fn.replace(/[()]/g, "\\$&");
      expect(sql.search(new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc} FROM PUBLIC, anon, authenticated;`))).toBeLessThan(
        sql.search(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc} TO`))
      );
    }
  });

  it("store_remove_device only ever sets removed_at, on the user's own active row", () => {
    const body = sql.match(/FUNCTION public\.store_remove_device[\s\S]*?\$\$([\s\S]*?)\$\$/)![1];
    expect(body).toMatch(/SECURITY DEFINER|BEGIN/);
    expect(sql).toMatch(/FUNCTION public\.store_remove_device\(p_user_id uuid, p_device_id uuid\)[\s\S]*?SECURITY DEFINER SET search_path = ''/);
    expect(body).toMatch(/SET removed_at = now\(\)/);
    expect(body).toMatch(/WHERE id = p_device_id AND user_id = p_user_id AND removed_at IS NULL/);
    expect(body).not.toMatch(/removed_at\s*=\s*NULL/i);
    expect(body).not.toMatch(/INSERT|DELETE/);
  });

  it("store_buyer_email() trusts only a confirmed email from auth.users, not the JWT claim", () => {
    const body = sql.match(/FUNCTION public\.store_buyer_email\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)![1];
    expect(body).toMatch(/FROM auth\.users u/);
    expect(body).toMatch(/u\.id = auth\.uid\(\)/);
    expect(body).toMatch(/u\.email_confirmed_at IS NOT NULL/);
    expect(body).not.toMatch(/auth\.jwt\(\)/);
    expect(sql).toMatch(/FUNCTION public\.store_buyer_email\(\)\s+RETURNS text\s+LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''/);
  });
});

// ────────────────────────────────────────────────────────────
// The device cap
// ────────────────────────────────────────────────────────────
describe("device cap: 3 active + 1 removed can never become 4 active", () => {
  async function threeActiveOneRemoved() {
    const db = createMemoryDb({}, { rpc: storeRpcs });
    const reg = (h: string) => registerDevice(db.client, { userId: "u1", deviceHash: h, label: "Test", limit: STORE_DEVICE_LIMIT });
    for (const h of ["h1", "h2", "h3"]) expect((await reg(h)).data).toBe("ok");
    const h1 = db.table("store_devices").find((r) => r.device_hash === "h1")!;
    expect((await removeDevice(db.client, "u1", h1.id as string)).data).toBe(true); // the official Remove
    expect((await reg("h4")).data).toBe("ok");
    const active = () => db.table("store_devices").filter((r) => r.user_id === "u1" && !r.removed_at).length;
    expect(active()).toBe(3);
    expect(db.table("store_devices")).toHaveLength(4);
    return { db, reg, h1, active };
  }

  it("a buyer's own UPDATE of removed_at back to NULL is refused, and the cap stays at 3", async () => {
    const { db, reg, h1, active } = await threeActiveOneRemoved();
    const buyer = buyerClient(db, "u1");

    const res = (await buyer.from("store_devices").update({ removed_at: null }).eq("id", h1.id).eq("user_id", "u1")) as { error: { code: string } | null };
    expect(res.error?.code).toBe("42501");
    expect(h1.removed_at).not.toBeNull();
    expect(active()).toBe(3);
    expect((await isDeviceActive(db.client, "u1", "h1")).data).toBe(false);
    expect((await reg("h5")).data).toBe("limit");

    // No other buyer-side door either.
    const ins = (await buyer.from("store_devices").insert({ user_id: "u1", device_hash: "h9", label: "x" })) as { error: { code: string } | null };
    expect(ins.error?.code).toBe("42501");
    const del = (await buyer.from("store_devices").delete().eq("id", h1.id)) as { error: { code: string } | null };
    expect(del.error?.code).toBe("42501");
    const up = (await buyer.from("store_devices").upsert({ id: h1.id, user_id: "u1", device_hash: "h1", removed_at: null })) as { error: { code: string } | null };
    expect(up.error?.code).toBe("42501");
    expect(active()).toBe(3);
    expect(db.table("store_devices")).toHaveLength(4);
  });

  it("the buyer still reads their own device list (SELECT), and only their own", async () => {
    const { db } = await threeActiveOneRemoved();
    await registerDevice(db.client, { userId: "u2", deviceHash: "x1", label: "Other", limit: 3 });
    const { data } = (await listDevices(buyerClient(db, "u1"), "u1")) as { data: Array<{ user_id: string }> };
    expect(data).toHaveLength(3);
    const { data: theirs } = (await listDevices(buyerClient(db, "u1"), "u2")) as { data: unknown[] };
    expect(theirs).toEqual([]);
  });

  it("store_remove_device never resurrects and never touches someone else's device", async () => {
    const { db, h1, active } = await threeActiveOneRemoved();
    const firstRemovedAt = h1.removed_at;
    expect((await removeDevice(db.client, "u1", h1.id as string)).data).toBe(false); // already removed: no-op
    expect(h1.removed_at).toBe(firstRemovedAt);
    await registerDevice(db.client, { userId: "u2", deviceHash: "x1", label: "Other", limit: 3 });
    const other = db.table("store_devices").find((r) => r.user_id === "u2")!;
    expect((await removeDevice(db.client, "u1", other.id as string)).data).toBe(false);
    expect(other.removed_at).toBeNull();
    expect(active()).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────
// Routes: device remove + EFT proof
// ────────────────────────────────────────────────────────────
let db: MemoryDb;
let who: { id: string; email: string; email_confirmed_at?: string | null } | null = null;
const objects = new Map<string, { bytes: number; type: string }>();
const storage = {
  from: (bucket: string) => ({
    upload: async (p: string, file: File, o?: { upsert?: boolean; contentType?: string }) => {
      const key = `${bucket}/${p}`;
      if (objects.has(key) && !o?.upsert) return { data: null, error: { message: "The resource already exists" } };
      objects.set(key, { bytes: file.size, type: o?.contentType ?? file.type });
      return { data: { path: p }, error: null };
    },
    remove: async (paths: string[]) => {
      for (const p of paths) objects.delete(`${bucket}/${p}`);
      return { data: [], error: null };
    },
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: db.client.from,
    rpc: db.client.rpc,
    auth: { getUser: async () => ({ data: { user: who }, error: null }) },
  }),
}));
vi.mock("@/lib/store/db", () => ({ storeAdminClient: () => ({ ...db.client, storage }) }));
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>();
  return { ...real, getRateLimiter: () => ({ hit: async () => ({ allowed: true }) }) };
});

const CONFIRMED = "2026-01-01T00:00:00Z";
const BUYER = { id: "buyer-1", email: "buyer@example.org", email_confirmed_at: CONFIRMED };
const OTHER = { id: "buyer-2", email: "other@example.org", email_confirmed_at: CONFIRMED };
const ORDER = "44444444-4444-4444-8444-444444444444";
const ORDER_2 = "55555555-5555-4555-8555-555555555555";
const CARD_ORDER = "66666666-6666-4666-8666-666666666666";

function order(id: string, over: Record<string, unknown> = {}) {
  return {
    id, reference: "ST-AAAAAA", buyer_email: BUYER.email, buyer_name: "Example Buyer", buyer_phone: null, buyer_user_id: null,
    status: "pending", payment_method: "eft", subtotal_cents: 18000, delivery_cents: 0, total_cents: 18000,
    fulfilment_method: "none", delivery_address: null, provider_payment_id: null, eft_proof_path: null, paid_at: null,
    marked_paid_by: null, cancelled_at: null, created_at: CONFIRMED, ...over,
  };
}

beforeEach(() => {
  db = createMemoryDb({ store_orders: [order(ORDER), order(ORDER_2), order(CARD_ORDER, { payment_method: "payfast" })] }, { rpc: storeRpcs });
  who = null;
  objects.clear();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function proof(token?: string, type = "application/pdf", size = 1000) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(size)], "proof.pdf", { type }));
  if (token !== undefined) form.append("t", token);
  return new Request("https://hub.test/x", { method: "POST", body: form, headers: { "x-forwarded-for": "7.7.7.7" } });
}

describe("DELETE /api/store/devices/[id] — the official Remove still works", () => {
  it("removes the signed-in buyer's own device; not someone else's; not when signed out or unconfirmed", async () => {
    const { DELETE } = await import("@/app/api/store/devices/[id]/route");
    await registerDevice(db.client, { userId: BUYER.id, deviceHash: "h1", label: "Mine", limit: 3 });
    await registerDevice(db.client, { userId: OTHER.id, deviceHash: "h1", label: "Theirs", limit: 3 });
    const [mine, theirs] = db.table("store_devices");

    expect((await DELETE(new Request("https://hub.test/x"), params(mine.id as string))).status).toBe(401);
    who = { ...BUYER, email_confirmed_at: null };
    expect((await DELETE(new Request("https://hub.test/x"), params(mine.id as string))).status).toBe(401);

    who = BUYER;
    expect((await DELETE(new Request("https://hub.test/x"), params(theirs.id as string))).status).toBe(404);
    expect(theirs.removed_at).toBeNull();
    const ok = await DELETE(new Request("https://hub.test/x"), params(mine.id as string));
    expect(ok.status).toBe(200);
    expect(mine.removed_at).toEqual(expect.any(String));
    expect((await DELETE(new Request("https://hub.test/x"), params(mine.id as string))).status).toBe(404);
  });
});

describe("POST /api/store/orders/[id]/eft-proof — no bare-UUID capability, no overwrite", () => {
  it("refuses the order id alone, a forged token and another order's token", async () => {
    const { POST } = await import("@/app/api/store/orders/[id]/eft-proof/route");
    expect((await POST(proof(), params(ORDER))).status).toBe(404);
    expect((await POST(proof("not-a-real-token"), params(ORDER))).status).toBe(404);
    expect((await POST(proof(signOrderToken(ORDER_2)), params(ORDER))).status).toBe(404);
    expect((await POST(proof(signOrderToken(ORDER, "some-other-signing-key")), params(ORDER))).status).toBe(404);
    expect(objects.size).toBe(0);
    expect(db.table("store_orders").find((o) => o.id === ORDER)!.eft_proof_path).toBeNull();
  });

  it("takes one proof with the signed token, then refuses to overwrite it", async () => {
    const { POST } = await import("@/app/api/store/orders/[id]/eft-proof/route");
    const t = signOrderToken(ORDER);
    const first = await POST(proof(t), params(ORDER));
    expect(first.status).toBe(200);
    const saved = db.table("store_orders").find((o) => o.id === ORDER)!.eft_proof_path as string;
    expect(saved).toMatch(new RegExp(`^eft/${ORDER}/[0-9a-f-]{36}\\.pdf$`));
    expect(objects.get(`store-source/${saved}`)).toEqual({ bytes: 1000, type: "application/pdf" });

    const second = await POST(proof(t, "image/png", 2000), params(ORDER));
    expect(second.status).toBe(409);
    expect(db.table("store_orders").find((o) => o.id === ORDER)!.eft_proof_path).toBe(saved);
    expect([...objects.keys()]).toEqual([`store-source/${saved}`]);
    expect(objects.get(`store-source/${saved}`)!.bytes).toBe(1000);
  });

  it("a race that loses the conditional update leaves the first proof and cleans up its own file", async () => {
    const { POST } = await import("@/app/api/store/orders/[id]/eft-proof/route");
    const row = db.table("store_orders").find((o) => o.id === ORDER)!;
    // Another upload wins between our read and our update.
    const realFrom = db.client.from;
    let reads = 0;
    db.client.from = (table: string) => {
      const b = realFrom(table);
      if (table === "store_orders" && ++reads === 2) row.eft_proof_path = "eft/winner.pdf";
      return b;
    };
    const res = await POST(proof(signOrderToken(ORDER)), params(ORDER));
    db.client.from = realFrom;
    expect(res.status).toBe(409);
    expect(row.eft_proof_path).toBe("eft/winner.pdf");
    expect(objects.size).toBe(0);
  });

  it("the signed-in buyer who placed the order needs no token; other or unconfirmed buyers are refused", async () => {
    const { POST } = await import("@/app/api/store/orders/[id]/eft-proof/route");
    who = OTHER;
    expect((await POST(proof(), params(ORDER_2))).status).toBe(404);
    who = { ...BUYER, email_confirmed_at: null };
    expect((await POST(proof(), params(ORDER_2))).status).toBe(404);
    who = BUYER;
    expect((await POST(proof(), params(ORDER_2))).status).toBe(200);
  });

  it("only for a pending EFT order", async () => {
    const { POST } = await import("@/app/api/store/orders/[id]/eft-proof/route");
    expect((await POST(proof(signOrderToken(CARD_ORDER)), params(CARD_ORDER))).status).toBe(409);
    db.table("store_orders").find((o) => o.id === ORDER)!.status = "paid";
    expect((await POST(proof(signOrderToken(ORDER)), params(ORDER))).status).toBe(409);
    expect(objects.size).toBe(0);
  });
});

describe("order tokens and the thanks link", () => {
  it("signs per order, verifies only the right one, and builds the thanks path", () => {
    const t = signOrderToken(ORDER);
    expect(verifyOrderToken(ORDER, t)).toBe(true);
    expect(verifyOrderToken(ORDER.toUpperCase(), t)).toBe(true);
    expect(verifyOrderToken(ORDER_2, t)).toBe(false);
    expect(verifyOrderToken(ORDER, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(verifyOrderToken(ORDER, "")).toBe(false);
    expect(verifyOrderToken("not-a-uuid", t)).toBe(false);
    expect(thanksPath(ORDER)).toBe(`/store/thanks?order=${ORDER}&t=${t}`);
  });

  it("canActOnOrder: a token, or the owning signed-in buyer (by uid or email)", () => {
    const o = { id: ORDER, buyer_email: BUYER.email, buyer_user_id: null as string | null };
    expect(canActOnOrder(o, {})).toBe(false);
    expect(canActOnOrder(o, { token: signOrderToken(ORDER) })).toBe(true);
    expect(canActOnOrder(o, { buyer: { userId: BUYER.id, email: BUYER.email } })).toBe(true);
    expect(canActOnOrder(o, { buyer: { userId: OTHER.id, email: OTHER.email } })).toBe(false);
    expect(canActOnOrder({ ...o, buyer_user_id: OTHER.id, buyer_email: "x@example.org" }, { buyer: { userId: OTHER.id, email: OTHER.email } })).toBe(true);
  });
});

describe("buyers need a confirmed email", () => {
  it("an auth user with no email_confirmed_at is not a buyer", () => {
    expect(buyerFromAuthUser(null)).toBeNull();
    expect(buyerFromAuthUser({ id: "u", email: "a@example.org", email_confirmed_at: null })).toBeNull();
    expect(buyerFromAuthUser({ id: "u", email: "a@example.org" })).toBeNull();
    expect(buyerFromAuthUser({ id: "u", email: null, email_confirmed_at: CONFIRMED })).toBeNull();
    expect(buyerFromAuthUser({ id: "u", email: "A@Example.org", email_confirmed_at: CONFIRMED })).toEqual({ userId: "u", email: "a@example.org" });
  });
});
