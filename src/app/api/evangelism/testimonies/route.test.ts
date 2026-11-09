import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestimonyRow } from "@/services/evangelism";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STORY_ID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  access: { view: true, submit: true, publish: false },
  rows: [] as unknown[],
  row: null as unknown,
  listCalls: [] as unknown[],
  created: [] as unknown[],
  published: [] as string[],
  deleted: 0,
  signedUploads: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock("@/lib/auth/check-evangelism-access", () => ({ getEvangelismAccess: async () => h.access }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          h.signedUploads.push(path);
          return { data: { token: "tok", signedUrl: `https://upload/${path}` }, error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));
vi.mock("@/services/evangelism", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/services/evangelism")>();
  const asRow = (v: unknown) => v as TestimonyRow;
  return {
    ...orig,
    signPhotoUrls: async () => new Map(),
    loadAuthorNames: async () => new Map(),
    listTestimonies: async (_c: unknown, opts: unknown) => {
      h.listCalls.push(opts);
      return { data: h.rows, error: null };
    },
    getTestimony: async () => ({ data: h.row, error: null }),
    createTestimony: async (_c: unknown, author: string, fields: Record<string, unknown>, status: string) => {
      const row = { ...baseRow(author), ...fields, status };
      h.created.push(row);
      h.row = row;
      return { data: asRow(row), error: null };
    },
    attachPhoto: async () => ({ error: null }),
    publishTestimony: async (_c: unknown, id: string) => {
      h.published.push(id);
      return { data: asRow({ ...(h.row as object), status: "published" }), error: null };
    },
    withholdTestimony: async () => ({ data: asRow({ ...(h.row as object), status: "withheld" }), error: null }),
    deleteTestimony: async () => ({ deleted: h.deleted, error: null }),
  };
});

import { GET, POST } from "./route";
import { DELETE, GET as GET_ONE, PATCH } from "./[id]/route";
import { POST as SIGN } from "../media/sign/route";

function baseRow(author = OTHER) {
  return {
    id: STORY_ID,
    author_user_id: author,
    title: "A conversation at the taxi rank",
    body: "We spoke with a man waiting for a taxi and prayed with him before the kombi came.",
    occurred_on: "2026-11-01",
    location_label: "Durban",
    staff_ministry_id: null,
    people_reached: 4,
    decisions: 1,
    outcome: "decision",
    consent_to_share: true,
    status: "submitted",
    published_at: null,
    published_by: null,
    withheld_reason: null,
    created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-01T08:00:00Z",
    evangelism_media: [],
  };
}

const story = {
  title: "A conversation at the taxi rank",
  body: "We spoke with a man waiting for a taxi and prayed with him before the kombi came.",
  occurred_on: "2026-11-01",
  location_label: "Durban",
  people_reached: 4,
  decisions: 1,
  outcome: "decision",
  consent_to_share: true,
};

const req = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://x/api/evangelism${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const ctx = { params: Promise.resolve({ id: STORY_ID }) };

const VIEWER = { view: true, submit: false, publish: false };
const SUBMITTER = { view: true, submit: true, publish: false };
const PUBLISHER = { view: true, submit: true, publish: true };
const NONE = { view: false, submit: false, publish: false };

beforeEach(() => {
  h.user = { id: USER };
  h.access = SUBMITTER;
  h.rows = [];
  h.row = null;
  h.listCalls = [];
  h.created = [];
  h.published = [];
  h.deleted = 0;
  h.signedUploads = [];
});

describe("GET /api/evangelism/testimonies", () => {
  it("401s without a session and 403s without access", async () => {
    h.user = null;
    expect((await GET(req("/testimonies"))).status).toBe(401);
    h.user = { id: USER };
    h.access = NONE;
    expect((await GET(req("/testimonies"))).status).toBe(403);
  });

  it("lists published stories for a viewer", async () => {
    h.access = VIEWER;
    const res = await GET(req("/testimonies"));
    expect(res.status).toBe(200);
    expect(h.listCalls[0]).toMatchObject({ status: "published" });
  });

  it("403s a bare submitter asking for the team's submitted list", async () => {
    h.access = SUBMITTER;
    expect((await GET(req("/testimonies?status=submitted"))).status).toBe(403);
    expect((await GET(req("/testimonies?status=withheld"))).status).toBe(403);
    expect(h.listCalls).toHaveLength(0);
  });

  it("gives a publisher the submitted list", async () => {
    h.access = PUBLISHER;
    h.rows = [baseRow()];
    const res = await GET(req("/testimonies?status=submitted"));
    expect(res.status).toBe(200);
    expect(h.listCalls[0]).toMatchObject({ status: "submitted" });
    expect((await res.json()).testimonies).toHaveLength(1);
  });

  it("scopes mine=1 to the caller and refuses it to viewers", async () => {
    expect((await GET(req("/testimonies?mine=1"))).status).toBe(200);
    expect(h.listCalls[0]).toMatchObject({ authorId: USER });
    h.access = VIEWER;
    expect((await GET(req("/testimonies?mine=1"))).status).toBe(403);
  });
});

describe("POST /api/evangelism/testimonies", () => {
  it("403s a viewer", async () => {
    h.access = VIEWER;
    expect((await POST(req("/testimonies", "POST", { ...story, intent: "submit" }))).status).toBe(403);
  });

  it("refuses to submit without consent", async () => {
    const res = await POST(req("/testimonies", "POST", { ...story, consent_to_share: false, intent: "submit" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("consent_required");
    expect(h.created).toHaveLength(0);
  });

  it("saves a draft without consent", async () => {
    const res = await POST(req("/testimonies", "POST", { ...story, consent_to_share: false, intent: "draft" }));
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ status: "draft", author_user_id: USER });
  });

  it("submits with consent", async () => {
    const res = await POST(req("/testimonies", "POST", { ...story, intent: "submit" }));
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ status: "submitted" });
  });

  it("refuses bad numbers and someone else's photo", async () => {
    expect((await POST(req("/testimonies", "POST", { ...story, decisions: 9, intent: "submit" }))).status).toBe(400);
    const photo = { path: `testimonies/${OTHER}/${STORY_ID}.jpg`, content_type: "image/jpeg", size: 100 };
    expect((await POST(req("/testimonies", "POST", { ...story, photo, intent: "submit" }))).status).toBe(400);
    expect(h.created).toHaveLength(0);
  });
});

describe("/api/evangelism/testimonies/:id", () => {
  it("404s a stranger on a draft RLS hides from them", async () => {
    h.access = SUBMITTER;
    h.row = null; // RLS returns nothing
    expect((await GET_ONE(req(`/testimonies/${STORY_ID}`), ctx)).status).toBe(404);
    expect((await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx)).status).toBe(404);
    expect((await DELETE(req(`/testimonies/${STORY_ID}`, "DELETE"), ctx)).status).toBe(404);
  });

  it("403s a submitter trying to publish", async () => {
    h.access = SUBMITTER;
    h.row = baseRow(USER);
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx);
    expect(res.status).toBe(403);
    expect(h.published).toHaveLength(0);
  });

  it("lets a publisher publish", async () => {
    h.access = PUBLISHER;
    h.row = baseRow(OTHER);
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx);
    expect(res.status).toBe(200);
    expect(h.published).toEqual([STORY_ID]);
    expect((await res.json()).testimony.status).toBe("published");
  });

  it("will not publish a story without consent", async () => {
    h.access = PUBLISHER;
    h.row = { ...baseRow(OTHER), status: "draft", consent_to_share: false };
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx);
    expect(res.status).toBe(400);
    expect(h.published).toHaveLength(0);
  });

  it("refuses an edit by someone who is not the author", async () => {
    h.access = SUBMITTER;
    h.row = baseRow(OTHER);
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { ...story, intent: "submit" }), ctx);
    expect(res.status).toBe(403);
  });

  it("refuses an author edit once the story is published", async () => {
    h.access = SUBMITTER;
    h.row = { ...baseRow(USER), status: "published" };
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { ...story, intent: "submit" }), ctx);
    expect(res.status).toBe(409);
  });

  it("lets an author delete only their own draft", async () => {
    h.access = SUBMITTER;
    h.row = baseRow(USER); // submitted
    expect((await DELETE(req(`/testimonies/${STORY_ID}`, "DELETE"), ctx)).status).toBe(403);
    h.row = { ...baseRow(USER), status: "draft" };
    h.deleted = 1;
    expect((await DELETE(req(`/testimonies/${STORY_ID}`, "DELETE"), ctx)).status).toBe(200);
  });
});

describe("POST /api/evangelism/media/sign", () => {
  it("403s a viewer", async () => {
    h.access = VIEWER;
    expect((await SIGN(req("/media/sign", "POST", { content_type: "image/jpeg", size: 100 }))).status).toBe(403);
  });

  it("refuses video and oversized photos", async () => {
    expect((await SIGN(req("/media/sign", "POST", { content_type: "video/mp4", size: 100 }))).status).toBe(400);
    expect((await SIGN(req("/media/sign", "POST", { content_type: "image/jpeg", size: 15728641 }))).status).toBe(400);
    expect(h.signedUploads).toHaveLength(0);
  });

  it("mints a path under the caller's own folder", async () => {
    const res = await SIGN(req("/media/sign", "POST", { content_type: "image/jpg", size: 100 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toMatch(new RegExp(`^testimonies/${USER}/[0-9a-f-]{36}\\.jpg$`));
    expect(body.content_type).toBe("image/jpeg");
  });
});
