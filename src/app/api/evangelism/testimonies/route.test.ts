import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attribution, TestimonyRow } from "@/services/evangelism";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STORY_ID = "33333333-3333-4333-8333-333333333333";
const FOLDER = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  access: { view: true, submit: true, publish: false },
  rows: [] as unknown[],
  row: null as unknown,
  mine: false,
  listCalls: [] as unknown[],
  created: [] as unknown[],
  published: [] as string[],
  deleted: 0,
  attachError: null as unknown,
  ledger: new Map<string, string>(), // storage_path -> user id
  recorded: [] as Array<{ path: string; userId: string }>,
  removed: [] as string[][],
  events: [] as string[],
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
    getAttribution: async (_c: unknown, ids: string[]) => ({
      data: new Map<string, Attribution>(
        ids.map((id) => [id, { id, is_mine: h.mine, author_name: null, published_by: null, withheld_reason: null }])
      ),
      error: null,
    }),
    listTestimonies: async (_c: unknown, opts: unknown) => {
      h.listCalls.push(opts);
      return { data: h.rows, error: null };
    },
    getTestimony: async () => ({ data: h.row, error: null }),
    createTestimony: async (_c: unknown, fields: Record<string, unknown>, status: string) => {
      const row = { ...baseRow(), ...fields, status };
      h.created.push(row);
      h.row = row;
      return { data: asRow(row), error: null };
    },
    attachPhoto: async () => ({ error: h.attachError }),
    publishTestimony: async (_c: unknown, id: string) => {
      h.published.push(id);
      return { data: asRow({ ...(h.row as object), status: "published" }), error: null };
    },
    withholdTestimony: async () => ({ data: asRow({ ...(h.row as object), status: "withheld" }), error: null }),
    deleteTestimony: async () => {
      h.events.push("delete-row");
      return { deleted: h.deleted, error: null };
    },
    recordUpload: async (_a: unknown, path: string, userId: string) => {
      h.recorded.push({ path, userId });
      h.ledger.set(path, userId);
      return { error: null };
    },
    ownedUploadPaths: async (_a: unknown, paths: string[], userId: string) =>
      paths.filter((p) => h.ledger.get(p) === userId),
    mediaPaths: async (_a: unknown, ids: string[]) => new Map(ids.map((id) => [id, `testimonies/${FOLDER}/${id}.jpg`])),
    removePhotoObjects: async (_a: unknown, paths: string[]) => {
      h.events.push("remove-objects");
      h.removed.push(paths);
    },
  };
});

import { GET, POST } from "./route";
import { DELETE, GET as GET_ONE, PATCH } from "./[id]/route";
import { POST as SIGN } from "../media/sign/route";

function baseRow() {
  return {
    id: STORY_ID,
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
    created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-01T08:00:00Z",
    evangelism_media: [] as unknown[],
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
  h.mine = false;
  h.listCalls = [];
  h.created = [];
  h.published = [];
  h.deleted = 0;
  h.attachError = null;
  h.ledger = new Map();
  h.recorded = [];
  h.removed = [];
  h.events = [];
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

  it("never exposes an author id or name to a viewer", async () => {
    h.access = VIEWER;
    h.rows = [{ ...baseRow(), status: "published" }];
    const body = await (await GET(req("/testimonies"))).json();
    expect(body.testimonies[0]).not.toHaveProperty("author_user_id");
    expect(body.testimonies[0]).not.toHaveProperty("author_name");
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

  it("asks for mine=1 through the RPC path and refuses it to viewers", async () => {
    expect((await GET(req("/testimonies?mine=1"))).status).toBe(200);
    expect(h.listCalls[0]).toMatchObject({ mine: true });
    expect(h.listCalls[0]).not.toHaveProperty("authorId");
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

  it("saves a draft without consent, never sending an author id", async () => {
    const res = await POST(req("/testimonies", "POST", { ...story, consent_to_share: false, intent: "draft" }));
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ status: "draft" });
    expect(h.created[0]).not.toHaveProperty("author_user_id");
  });

  it("submits with consent", async () => {
    const res = await POST(req("/testimonies", "POST", { ...story, intent: "submit" }));
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ status: "submitted" });
  });

  it("refuses bad numbers and a malformed photo path", async () => {
    expect((await POST(req("/testimonies", "POST", { ...story, decisions: 9, intent: "submit" }))).status).toBe(400);
    const photo = { path: "testimonies/me/photo.jpg", content_type: "image/jpeg", size: 100 };
    expect((await POST(req("/testimonies", "POST", { ...story, photo, intent: "submit" }))).status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  it("does not delete someone else's upload when a photo fails to attach", async () => {
    const theirs = `testimonies/${FOLDER}/${OTHER}.jpg`;
    h.ledger.set(theirs, OTHER);
    h.attachError = { code: "42501", message: "new row violates row-level security policy" };
    const res = await POST(
      req("/testimonies", "POST", {
        ...story,
        intent: "submit",
        photo: { path: theirs, content_type: "image/jpeg", size: 100 },
      })
    );
    expect(res.status).toBe(201);
    expect((await res.json()).photo_error).toBeTruthy();
    expect(h.removed.flat()).not.toContain(theirs);
  });

  it("cleans up the caller's own upload when a photo fails to attach", async () => {
    const mine = `testimonies/${FOLDER}/${STORY_ID}.jpg`;
    h.ledger.set(mine, USER);
    h.attachError = { message: "boom" };
    await POST(
      req("/testimonies", "POST", { ...story, intent: "submit", photo: { path: mine, content_type: "image/jpeg", size: 100 } })
    );
    expect(h.removed.flat()).toContain(mine);
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
    h.mine = true;
    h.row = baseRow();
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx);
    expect(res.status).toBe(403);
    expect(h.published).toHaveLength(0);
  });

  it("lets a publisher publish a submitted story", async () => {
    h.access = PUBLISHER;
    h.row = baseRow();
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx);
    expect(res.status).toBe(200);
    expect(h.published).toEqual([STORY_ID]);
    expect((await res.json()).testimony.status).toBe("published");
  });

  it("will not publish a story without consent", async () => {
    h.access = PUBLISHER;
    h.row = { ...baseRow(), consent_to_share: false };
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx);
    expect(res.status).toBe(400);
    expect(h.published).toHaveLength(0);
  });

  it("will not publish a draft that was never submitted", async () => {
    h.access = PUBLISHER;
    h.row = { ...baseRow(), status: "draft" };
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { action: "publish" }), ctx);
    expect(res.status).toBe(409);
    expect(h.published).toHaveLength(0);
  });

  it("refuses an edit by someone who is not the author (per the DB's is_mine)", async () => {
    h.access = PUBLISHER;
    h.mine = false;
    h.row = baseRow();
    const res = await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { ...story, intent: "submit" }), ctx);
    expect(res.status).toBe(403);
  });

  it("refuses an author edit once the story is published or withheld", async () => {
    h.access = SUBMITTER;
    h.mine = true;
    h.row = { ...baseRow(), status: "published" };
    expect((await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { ...story, intent: "submit" }), ctx)).status).toBe(
      409
    );
    h.row = { ...baseRow(), status: "withheld" };
    expect((await PATCH(req(`/testimonies/${STORY_ID}`, "PATCH", { ...story, intent: "submit" }), ctx)).status).toBe(
      409
    );
  });

  it("lets an author delete only their own draft", async () => {
    h.access = SUBMITTER;
    h.mine = true;
    h.row = baseRow(); // submitted
    expect((await DELETE(req(`/testimonies/${STORY_ID}`, "DELETE"), ctx)).status).toBe(403);
    h.row = { ...baseRow(), status: "draft" };
    h.deleted = 1;
    expect((await DELETE(req(`/testimonies/${STORY_ID}`, "DELETE"), ctx)).status).toBe(200);
  });

  it("deletes the row first and removes objects only after exactly one row went", async () => {
    h.access = PUBLISHER;
    h.row = { ...baseRow(), evangelism_media: [{ id: "m1", content_type: "image/jpeg", size_bytes: 1, sort_order: 0 }] };
    h.deleted = 1;
    expect((await DELETE(req(`/testimonies/${STORY_ID}`, "DELETE"), ctx)).status).toBe(200);
    expect(h.events).toEqual(["delete-row", "remove-objects"]);

    h.events = [];
    h.removed = [];
    h.deleted = 0; // RLS refused
    expect((await DELETE(req(`/testimonies/${STORY_ID}`, "DELETE"), ctx)).status).toBe(403);
    expect(h.events).toEqual(["delete-row"]);
    expect(h.removed).toHaveLength(0);
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

  it("mints a random/random path with no user id and records it in the ledger", async () => {
    const res = await SIGN(req("/media/sign", "POST", { content_type: "image/jpg", size: 100 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toMatch(/^testimonies\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
    expect(body.path).not.toContain(USER);
    expect(body.content_type).toBe("image/jpeg");
    expect(h.recorded).toEqual([{ path: body.path, userId: USER }]);
  });
});
