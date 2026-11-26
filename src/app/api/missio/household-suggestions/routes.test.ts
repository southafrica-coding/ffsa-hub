import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The routes only wire the pastors-only check to the lib. The lib is
// covered in src/lib/missio/household-suggestions.test.ts.

const state = vi.hoisted(() => ({
  allowed: true,
  roles: [] as unknown[],
  list: vi.fn(),
  review: vi.fn(),
}));

vi.mock("@/lib/missio/access", () => ({
  MISSIO_SLUG: "missio",
  MISSIO_PEOPLE_ROLES: ["pastor"],
  requireOrgRole: async (_slug: string, roles: unknown) => {
    state.roles.push(roles);
    if (!state.allowed) return { response: NextResponse.json({ error: "Not authorized", code: "forbidden" }, { status: 403 }) };
    return { user: { id: "pastor-1" }, orgId: "org-missio", roles: ["pastor"], supabase: {} };
  },
}));
vi.mock("@/lib/missio/limit", () => ({ missioRateLimit: async () => null }));
vi.mock("@/lib/missio/household-suggestions", () => ({ listSuggestions: state.list, reviewSuggestion: state.review }));

const { GET } = await import("./route");
const { POST } = await import("./[id]/route");

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request("http://hub.test/x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  state.allowed = true;
  state.roles = [];
  state.list.mockReset().mockResolvedValue({ ok: true, suggestions: [] });
  state.review.mockReset().mockResolvedValue({ ok: true, status: "dismissed", household: null });
});

describe("household suggestion routes", () => {
  it("are pastors only: anyone else gets 403 and the lib is never called", async () => {
    state.allowed = false;
    expect((await GET(new Request("http://hub.test/api/missio/household-suggestions"))).status).toBe(403);
    expect((await POST(post({ action: "dismiss" }), ctx(ID))).status).toBe(403);
    expect(state.roles).toEqual([["pastor"], ["pastor"]]);
    expect(state.list).not.toHaveBeenCalled();
    expect(state.review).not.toHaveBeenCalled();
  });

  it("GET lists, optionally for one person, and refuses a bad id", async () => {
    const all = await GET(new Request("http://hub.test/api/missio/household-suggestions"));
    expect(await all.json()).toEqual({ suggestions: [] });
    expect(all.headers.get("cache-control")).toBe("no-store");
    await GET(new Request(`http://hub.test/api/missio/household-suggestions?personId=${ID}`));
    expect(state.list).toHaveBeenLastCalledWith(expect.anything(), { personId: ID });
    expect((await GET(new Request("http://hub.test/api/missio/household-suggestions?personId=nope"))).status).toBe(400);
  });

  it("POST passes the answer through, and returns the household_exists details", async () => {
    const ok = await POST(post({ action: "dismiss" }), ctx(ID));
    expect(await ok.json()).toEqual({ status: "dismissed", household: null });
    state.review.mockResolvedValue({
      ok: false,
      status: 409,
      code: "household_exists",
      error: "One of them is already in a household.",
      existing: { householdTitle: "The Examples", joiningPersonId: ID },
    });
    const confirm = await POST(post({ action: "accept" }), ctx(ID));
    expect(confirm.status).toBe(409);
    expect(await confirm.json()).toMatchObject({ code: "household_exists", existing: { householdTitle: "The Examples" } });
    expect((await POST(post({ action: "accept" }), ctx("not-a-uuid"))).status).toBe(404);
    expect((await POST(new Request("http://hub.test/x", { method: "POST", body: "{" }), ctx(ID))).status).toBe(400);
  });
});
