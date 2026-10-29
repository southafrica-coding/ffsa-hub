import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/consent — the server half of signing the NDA (and the other
// required policies). It must be idempotent, so the onboarding "Try again"
// after a timed-out save never stacks duplicate signatures, and it must
// answer every request (bad body included) rather than throw.

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  current: { version: "nda-v1.0-2026-08", kind: "nda" } as
    | { version: string; kind: string }
    | null,
  existing: null as { id: string; accepted_at: string } | null,
  insertError: null as { message: string } | null,
  inserts: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock("@/services/consent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/consent")>();
  return {
    ...actual,
    getCurrentConsentAgreement: async () => ({ data: state.current, error: null }),
    getUserAcceptance: async () => ({ data: state.existing, error: null }),
    recordConsent: async (_client: unknown, data: unknown) => {
      state.inserts.push(data);
      return state.insertError
        ? { data: null, error: state.insertError }
        : { data: { id: "r1", accepted_at: "2026-10-26T08:00:00Z" }, error: null };
    },
  };
});

import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const NDA_BODY = {
  kind: "nda",
  agreement_version: "nda-v1.0-2026-08",
  source: "onboarding",
};

beforeEach(() => {
  state.user = { id: "u1" };
  state.current = { version: "nda-v1.0-2026-08", kind: "nda" };
  state.existing = null;
  state.insertError = null;
  state.inserts = [];
});

describe("POST /api/consent", () => {
  it("records a new NDA signature and returns when it was signed", async () => {
    const res = await POST(post(NDA_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      version: "nda-v1.0-2026-08",
      accepted_at: "2026-10-26T08:00:00Z",
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      agreement_version: "nda-v1.0-2026-08",
      source: "onboarding",
      user_id: "u1",
      ip_address: "1.2.3.4",
    });
  });

  it("is idempotent: an existing signature is returned, not duplicated", async () => {
    state.existing = { id: "r0", accepted_at: "2026-10-25T10:00:00Z" };
    const res = await POST(post(NDA_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      alreadyAccepted: true,
      accepted_at: "2026-10-25T10:00:00Z",
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("returns the database error as a 500 the client can show", async () => {
    state.insertError = { message: "new row violates row-level security policy" };
    const res = await POST(post(NDA_BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "new row violates row-level security policy",
    });
  });

  it("refuses a stale version", async () => {
    const res = await POST(post({ ...NDA_BODY, agreement_version: "nda-v0" }));
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it("answers 400 to a body that isn't JSON instead of throwing", async () => {
    const res = await POST(post("not json"));
    expect(res.status).toBe(400);
  });

  it("requires a session", async () => {
    state.user = null;
    const res = await POST(post(NDA_BODY));
    expect(res.status).toBe(401);
  });
});
