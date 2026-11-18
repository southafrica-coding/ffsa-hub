import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { issuedAvailabilityToken } from "./token";
import { ensureLiveLink, type VolunteerRequest } from "./service";

const SECRET = "b".repeat(32);
const OLD_SECRET = "a".repeat(32);
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const WINNER_NONCE = "c".repeat(43);

const request: VolunteerRequest = {
  id: REQUEST_ID,
  startsOn: "2026-11-16",
  endsOn: "2026-12-31",
  serviceDates: ["2026-11-15", "2026-11-22"],
  createdAt: "2026-11-01T00:00:00.000Z",
};

type Row = { nonce: string; token_hash: string; expires_at: string; request_id?: string; contact_id?: string };

function tokenAdmin(initial: Row | null) {
  let row = initial;
  const calls: { op: "insert" | "upsert"; options?: { ignoreDuplicates?: boolean; onConflict?: string } }[] = [];
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle: async () => ({ data: row, error: null }),
    insert: async (payload: Row, options?: { ignoreDuplicates?: boolean; onConflict?: string }) => {
      calls.push({ op: "insert", options });
      if (!options?.ignoreDuplicates) row = payload;
      else if (!row) row = payload;
      return { error: null };
    },
    upsert: async (payload: Row) => {
      calls.push({ op: "upsert" });
      row = payload;
      return { error: null };
    },
  };
  return {
    calls,
    from() {
      return builder;
    },
    current: () => row,
  };
}

describe("ensureLiveLink", () => {
  beforeEach(() => {
    process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = SECRET;
  });

  it("writes a new link when the stored hash was made with another secret", async () => {
    const stale = issuedAvailabilityToken({
      secret: OLD_SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: WINNER_NONCE,
    });
    const admin = tokenAdmin({
      nonce: stale.nonce,
      token_hash: stale.token_hash,
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    const result = await ensureLiveLink(admin, request, CONTACT_ID, "https://hub.example.org", new Date("2026-11-18T12:00:00.000Z"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.replaced).toBe(true);
    expect(admin.calls.some((call) => call.op === "upsert")).toBe(true);
    const fresh = issuedAvailabilityToken({
      secret: SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: admin.current()?.nonce,
    });
    expect(result.body.url).toBe(`https://hub.example.org/serve/missio/${fresh.raw}`);
  });

  it("does not overwrite a nonce another copy already inserted", async () => {
    const winner = issuedAvailabilityToken({
      secret: SECRET,
      requestId: REQUEST_ID,
      contactId: CONTACT_ID,
      nonce: WINNER_NONCE,
    });
    const admin = tokenAdmin(null);
    let inserted = false;
    const client = {
      calls: admin.calls,
      from() {
        return {
          select: () => client.from(),
          eq: () => client.from(),
          maybeSingle: async () => {
            if (!inserted) return { data: null, error: null };
            return {
              data: {
                nonce: winner.nonce,
                token_hash: winner.token_hash,
                expires_at: "2099-01-01T00:00:00.000Z",
              },
              error: null,
            };
          },
          insert: async (payload: Row, options?: { ignoreDuplicates?: boolean; onConflict?: string }) => {
            admin.calls.push({ op: "insert", options });
            inserted = true;
            expect(options?.ignoreDuplicates).toBe(true);
            expect(options?.onConflict).toBe("request_id,contact_id");
            expect(payload.nonce).not.toBe(winner.nonce);
            return { error: null };
          },
          upsert: async () => {
            admin.calls.push({ op: "upsert" });
            return { error: null };
          },
        };
      },
    };

    const result = await ensureLiveLink(client, request, CONTACT_ID, "https://hub.example.org", new Date("2026-11-18T12:00:00.000Z"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.replaced).toBe(false);
    expect(result.body.url).toBe(`https://hub.example.org/serve/missio/${winner.raw}`);
    expect(admin.calls.filter((call) => call.op === "upsert")).toHaveLength(0);
    expect(admin.calls.filter((call) => call.op === "insert")).toHaveLength(1);
  });
});
