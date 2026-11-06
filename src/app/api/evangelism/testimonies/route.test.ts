import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111",
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  access: { view: true, submit: true, publish: false },
  insertError: null as { code?: string; message: string } | null,
  inserted: null as Record<string, unknown> | null,
  rows: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/auth/check-evangelism-access", () => ({
  getEvangelismAccess: async () => h.access,
}));
vi.mock("@/lib/rate-limit", () => ({
  getRateLimiter: () => ({
    hit: async () => ({ allowed: true, remaining: 1, resetAt: new Date(Date.now() + 30_000) }),
  }),
  retryAfterSeconds: () => 30,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/evangelism/signed-media", () => ({
  signTestimonyMedia: async () => new Map(),
  loadAuthorNames: async () => new Map([[h.userId, "Thabo N"]]),
}));
vi.mock("@/services/evangelism", () => ({
  listTestimonies: async () => ({ data: h.rows, error: null }),
  getTestimony: async () => ({ data: h.inserted, error: null }),
  insertTestimony: async (_client: unknown, row: Record<string, unknown>) => {
    h.inserted = {
      ...row,
      id: "t1",
      created_at: "2026-11-06T08:00:00.000Z",
      updated_at: "2026-11-06T08:00:00.000Z",
      evangelism_media: [],
    };
    return { data: h.inserted, error: h.insertError };
  },
  insertTestimonyMedia: async () => ({ error: null }),
  deleteTestimony: async () => ({ error: null }),
}));

import { GET, POST } from "./route";

const story = {
  title: "A conversation at the taxi rank",
  body: "We spoke with a man waiting for the taxi. He asked us to pray, and he gave his life to Jesus before the kombi came.",
  occurred_on: "2026-11-01",
  location_label: "Durban base",
  people_reached: 4,
  decisions: 1,
  outcome: "decision",
  consent_to_share: true,
};

beforeEach(() => {
  h.user = { id: h.userId };
  h.access = { view: true, submit: true, publish: false };
  h.insertError = null;
  h.inserted = null;
  h.rows = [];
});

describe("POST /api/evangelism/testimonies", () => {
  it("requires a signed-in submitter", async () => {
    h.user = null;
    const res = await POST(new Request("http://x/api/evangelism/testimonies", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);

    h.user = { id: h.userId };
    h.access = { view: true, submit: false, publish: false };
    const denied = await POST(
      new Request("http://x/api/evangelism/testimonies", { method: "POST", body: JSON.stringify(story) })
    );
    expect(denied.status).toBe(403);
  });

  it("rejects a story whose numbers do not add up", async () => {
    const res = await POST(
      new Request("http://x/api/evangelism/testimonies", {
        method: "POST",
        body: JSON.stringify({ ...story, decisions: 9 }),
      })
    );
    expect(res.status).toBe(400);
    expect(h.inserted).toBeNull();
  });

  it("saves a draft for the caller and refuses to let them publish", async () => {
    const res = await POST(
      new Request("http://x/api/evangelism/testimonies", {
        method: "POST",
        body: JSON.stringify({ ...story, status: "submitted" }),
      })
    );
    expect(res.status).toBe(201);
    expect(h.inserted).toMatchObject({ author_user_id: h.userId, status: "submitted", consent_to_share: true });
    const body = await res.json();
    expect(body.can_publish).toBe(false);
    expect(body.testimony.author_name).toBe("Thabo N");
    expect(body.testimony.withheld_reason).toBeUndefined();

    const published = await POST(
      new Request("http://x/api/evangelism/testimonies", {
        method: "POST",
        body: JSON.stringify({ ...story, status: "published" }),
      })
    );
    expect(published.status).toBe(400);
  });

  it("says the module is not switched on when the table is missing", async () => {
    h.insertError = { code: "PGRST205", message: "evangelism_testimonies" };
    const res = await POST(
      new Request("http://x/api/evangelism/testimonies", { method: "POST", body: JSON.stringify(story) })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "evangelism_not_enabled" });
  });
});

describe("GET /api/evangelism/testimonies", () => {
  it("hides unpublished lists from someone who can only view", async () => {
    h.access = { view: true, submit: false, publish: false };
    const res = await GET(new Request("http://x/api/evangelism/testimonies?status=draft"));
    expect(res.status).toBe(403);
  });

  it("hides the author on a published story the viewer did not write", async () => {
    h.access = { view: true, submit: false, publish: false };
    h.rows = [
      {
        id: "pub",
        author_user_id: "someone-else",
        title: "A published story",
        body: "Long enough to be a testimony for the people who were there that afternoon.",
        occurred_on: "2026-11-01",
        location_label: "Durban base",
        people_reached: 1,
        decisions: 0,
        outcome: "conversation",
        consent_to_share: true,
        status: "published",
        published_at: "2026-11-01T00:00:00.000Z",
        published_by: "someone-else",
        withheld_reason: "private",
        created_at: "2026-11-01T00:00:00.000Z",
        updated_at: "2026-11-01T00:00:00.000Z",
        evangelism_media: [],
      },
    ];
    const res = await GET(new Request("http://x/api/evangelism/testimonies"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_publish).toBe(false);
    expect("author_name" in body.testimonies[0]).toBe(false);
    expect("author_user_id" in body.testimonies[0]).toBe(false);
    expect("withheld_reason" in body.testimonies[0]).toBe(false);
  });

  it("keeps team draft and review queues publisher-only", async () => {
    h.access = { view: true, submit: true, publish: false };
    expect((await GET(new Request("http://x/api/evangelism/testimonies?status=submitted"))).status).toBe(403);
    expect((await GET(new Request("http://x/api/evangelism/testimonies?status=draft"))).status).toBe(403);
    const mine = await GET(new Request("http://x/api/evangelism/testimonies?status=draft&mine=1"));
    expect(mine.status).toBe(200);
    expect((await mine.json()).can_publish).toBe(false);
  });
});
