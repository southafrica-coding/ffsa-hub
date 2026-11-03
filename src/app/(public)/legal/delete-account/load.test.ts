import { beforeEach, describe, expect, it, vi } from "vitest";

// /legal/delete-account is public. What it shows comes from loadDeletionPage():
// signed out → sign-in / email instructions; signed in → the form, or the
// open request. (The page's JSX itself can't be imported here: the repo's
// vitest setup has tsconfig jsx "preserve".)

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  result: { data: null, error: null } as { data: unknown; error: unknown },
  filters: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => b,
      eq: (col: string, val: unknown) => {
        state.filters.push([col, val]);
        return b;
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve(state.result).then(ok),
    };
    return {
      from: () => b,
      auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    };
  },
}));

import { loadDeletionPage } from "./load";

beforeEach(() => {
  state.user = null;
  state.result = { data: null, error: null };
  state.filters = [];
  delete process.env.ACCOUNT_DELETION_CONTACT_EMAIL;
});

describe("loadDeletionPage", () => {
  it("signed out: no request lookup, just the contact address", async () => {
    expect(await loadDeletionPage()).toEqual({ signedIn: false, contactEmail: "info@fireandfragrance.com" });
    expect(state.filters).toEqual([]);
  });

  it("signed in with no request: the form", async () => {
    state.user = { id: "me" };
    expect(await loadDeletionPage()).toEqual({
      signedIn: true,
      contactEmail: "info@fireandfragrance.com",
      request: null,
    });
    expect(state.filters).toContainEqual(["user_id", "me"]);
    expect(state.filters).toContainEqual(["status", "open"]);
  });

  it("signed in with an open request: its date and reason", async () => {
    state.user = { id: "me" };
    state.result = {
      data: { id: "r1", status: "open", reason: "bye", source: "app", requested_at: "2026-11-03T10:00:00Z", cancelled_at: null },
      error: null,
    };
    expect(await loadDeletionPage()).toMatchObject({
      signedIn: true,
      request: { requestedAt: "2026-11-03T10:00:00Z", reason: "bye" },
    });
  });

  it("table not there yet: the form (no error shown)", async () => {
    state.user = { id: "me" };
    state.result = { data: null, error: { code: "PGRST205", message: "missing" } };
    expect(await loadDeletionPage()).toMatchObject({ signedIn: true, request: null });
  });

  it("uses the configured contact address", async () => {
    process.env.ACCOUNT_DELETION_CONTACT_EMAIL = "privacy@ffsa.test";
    expect((await loadDeletionPage()).contactEmail).toBe("privacy@ffsa.test");
  });
});
