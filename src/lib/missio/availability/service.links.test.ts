import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { issuedAvailabilityToken } from "./token";
import { ensureLiveLink, linkForNudge, type VolunteerRequest } from "./service";

const SECRET = "b".repeat(32);
const OLD_SECRET = "a".repeat(32);
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const WINNER_NONCE = "c".repeat(43);
const NOW = new Date("2026-11-18T12:00:00.000Z");
const ORIGIN = "https://hub.example.org";

const request: VolunteerRequest = {
  id: REQUEST_ID,
  startsOn: "2026-11-16",
  endsOn: "2026-12-31",
  serviceDates: ["2026-11-15", "2026-11-22"],
  createdAt: "2026-11-01T00:00:00.000Z",
};

type Row = { nonce: string; token_hash: string; expires_at: string };

type WriteOptions = { onConflict?: string; ignoreDuplicates?: boolean };

/**
 * Upsert with ignoreDuplicates leaves an existing row alone. A duplicate can
 * also surface as 23505. Rotate is an update that only lands when token_hash
 * is still the value we read.
 */
function tokenAdmin(options: {
  initial: Row | null;
  duplicateCode?: boolean;
  /** After a losing compare-and-swap, the next read returns this row. */
  lostRotate?: Row;
}) {
  let row = options.initial;
  const calls: { op: "upsert" | "update"; options?: WriteOptions; tokenHash?: string }[] = [];
  let updating = false;
  let pending: Partial<Row> | null = null;
  let expectedHash = "";

  const builder = {
    select() {
      if (!updating) return builder;
      updating = false;
      const lost = Boolean(options.lostRotate);
      if (!lost && row && row.token_hash === expectedHash && pending) {
        row = { ...row, ...pending };
        return Promise.resolve({
          data: [{ nonce: row.nonce, token_hash: row.token_hash, expires_at: row.expires_at }],
          error: null,
        });
      }
      if (options.lostRotate) row = options.lostRotate;
      return Promise.resolve({ data: [], error: null });
    },
    eq(column: string, value: string) {
      if (column === "token_hash") expectedHash = value;
      calls[calls.length - 1] && (calls[calls.length - 1].tokenHash = column === "token_hash" ? value : calls[calls.length - 1].tokenHash);
      return builder;
    },
    maybeSingle: async () => ({ data: row, error: null }),
    update(payload: Partial<Row>) {
      updating = true;
      pending = payload;
      expectedHash = "";
      calls.push({ op: "update" });
      return builder;
    },
    upsert: async (payload: Row, upsertOptions?: WriteOptions) => {
      calls.push({ op: "upsert", options: upsertOptions });
      if (options.duplicateCode) return { error: { code: "23505", message: "duplicate key" } };
      if (upsertOptions?.ignoreDuplicates && row) return { error: null };
      row = payload;
      return { error: null };
    },
  };

  return {
    calls,
    from: () => builder,
    current: () => row,
  };
}

describe("ensureLiveLink", () => {
  beforeEach(() => {
    process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = SECRET;
  });

  it("compare-and-swaps a new nonce when the stored hash was made with another secret", async () => {
    const stale = issuedAvailabilityToken({
      secret: OLD_SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: "d".repeat(43),
    });
    const admin = tokenAdmin({
      initial: { nonce: stale.nonce, token_hash: stale.token_hash, expires_at: "2099-01-01T00:00:00.000Z" },
    });

    const result = await ensureLiveLink(admin, request, CONTACT_ID, ORIGIN, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.replaced).toBe(true);
    expect(admin.calls.filter((call) => call.op === "upsert")).toHaveLength(0);
    const update = admin.calls.filter((call) => call.op === "update");
    expect(update).toHaveLength(1);
    expect(update[0]?.tokenHash).toBe(stale.token_hash);
    const fresh = issuedAvailabilityToken({
      secret: SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: admin.current()?.nonce,
    });
    expect(result.body.url).toBe(`${ORIGIN}/serve/missio/${fresh.raw}`);
  });

  it("keeps the winning nonce when upsert ignores a duplicate", async () => {
    const winner = issuedAvailabilityToken({
      secret: SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: WINNER_NONCE,
    });
    const existing: Row = {
      nonce: winner.nonce,
      token_hash: winner.token_hash,
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    let reads = 0;
    const admin = tokenAdmin({ initial: null });
    const read = admin.from().maybeSingle;
    admin.from().maybeSingle = async () => {
      reads += 1;
      if (reads === 1) return { data: null, error: null };
      return read();
    };
    const write = admin.from().upsert;
    admin.from().upsert = async (payload, upsertOptions) => {
      const result = await write(payload, upsertOptions);
      admin.from().maybeSingle = async () => ({ data: existing, error: null });
      return result;
    };

    const result = await ensureLiveLink(admin, request, CONTACT_ID, ORIGIN, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.replaced).toBe(false);
    expect(result.body.url).toBe(`${ORIGIN}/serve/missio/${winner.raw}`);
    expect(admin.calls.filter((call) => call.op === "update")).toHaveLength(0);
    expect(admin.calls.find((call) => call.op === "upsert")?.options).toEqual({
      onConflict: "request_id,contact_id",
      ignoreDuplicates: true,
    });
  });

  it("re-reads after a 23505 instead of failing the copy", async () => {
    const winner = issuedAvailabilityToken({
      secret: SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: WINNER_NONCE,
    });
    const existing: Row = {
      nonce: winner.nonce,
      token_hash: winner.token_hash,
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    let reads = 0;
    const admin = tokenAdmin({ initial: existing, duplicateCode: true });
    admin.from().maybeSingle = async () => {
      reads += 1;
      if (reads === 1) return { data: null, error: null };
      return { data: existing, error: null };
    };

    const result = await ensureLiveLink(admin, request, CONTACT_ID, ORIGIN, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.url).toBe(`${ORIGIN}/serve/missio/${winner.raw}`);
    expect(admin.calls.filter((call) => call.op === "update")).toHaveLength(0);
    expect(admin.current()?.nonce).toBe(WINNER_NONCE);
  });

  it("returns the other pastor's new link when the compare-and-swap loses", async () => {
    const stale = issuedAvailabilityToken({
      secret: OLD_SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: "d".repeat(43),
    });
    const winner = issuedAvailabilityToken({
      secret: SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: WINNER_NONCE,
    });
    const admin = tokenAdmin({
      initial: { nonce: stale.nonce, token_hash: stale.token_hash, expires_at: "2099-01-01T00:00:00.000Z" },
      lostRotate: { nonce: winner.nonce, token_hash: winner.token_hash, expires_at: "2099-01-01T00:00:00.000Z" },
    });

    const result = await ensureLiveLink(admin, request, CONTACT_ID, ORIGIN, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.url).toBe(`${ORIGIN}/serve/missio/${winner.raw}`);
    expect(admin.calls.filter((call) => call.op === "update")).toHaveLength(1);
    expect(admin.current()?.nonce).toBe(WINNER_NONCE);
  });
});

describe("linkForNudge", () => {
  beforeEach(() => {
    process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = SECRET;
  });

  it("skips a mismatched hash without writing", async () => {
    const stale = issuedAvailabilityToken({
      secret: OLD_SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: WINNER_NONCE,
    });
    const admin = tokenAdmin({
      initial: { nonce: stale.nonce, token_hash: stale.token_hash, expires_at: "2099-01-01T00:00:00.000Z" },
    });

    const result = await linkForNudge(admin, request, CONTACT_ID, ORIGIN, NOW);

    expect(result).toEqual({ skip: true });
    expect(admin.calls).toHaveLength(0);
    expect(admin.current()?.nonce).toBe(WINNER_NONCE);
  });
});
