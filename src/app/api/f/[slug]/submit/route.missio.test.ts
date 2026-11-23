import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/f/missio-weekly-feedback/submit: the Missio weekly feedback
// form is handed to its own public flow (house picker), even with the
// row's access_mode still "token", and none of the generic contact,
// label or workflow steps run. Every collaborator is a stub.

const h = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  handled: [] as unknown[],
  upserts: 0,
  signedIn: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.signedIn ? { id: "u1" } : null } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/services/forms", () => ({ getFormBySlug: async () => ({ data: h.form, error: null }) }));
vi.mock("@/services/contact-upsert", () => ({
  upsertContactWithDedup: async () => {
    h.upserts += 1;
    return { data: { action: "created", contactId: "c1" }, error: null };
  },
}));
vi.mock("@/lib/missio/public-feedback", () => ({
  handlePublicWeeklyFeedback: async (req: Request, db: unknown) => {
    h.handled.push({ body: await req.json(), db });
    return Response.json({ ok: true, meetingDate: "2026-11-22" });
  },
}));

import { POST } from "./route";

const missioForm = {
  id: "2096791c-8e33-4077-a17e-92c5f0f1ebaf",
  slug: "missio-weekly-feedback",
  kind: "missio_weekly_feedback",
  subject_type: "house",
  access_mode: "token",
  name: "Missio weekly feedback",
  is_active: true,
  event_id: null,
  schema: { version: 1, branding: {}, thankYou: {}, steps: [] },
};

const send = (slug: string, body: unknown) =>
  POST(new Request(`http://x/api/f/${slug}/submit`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });

beforeEach(() => {
  h.handled = [];
  h.upserts = 0;
  h.signedIn = false;
  h.form = { ...missioForm };
});

describe("Missio weekly feedback via /api/f/[slug]/submit", () => {
  it("opens without a login although access_mode is token, and goes to the Missio handler", async () => {
    const res = await send("missio-weekly-feedback", { houseId: "h", answers: { attendance: 3 }, website: "" });
    expect(res.status).toBe(200);
    expect(h.handled).toEqual([{ body: { houseId: "h", answers: { attendance: 3 }, website: "" }, db: { admin: true } }]);
    expect(h.upserts).toBe(0);
  });

  it("an inactive form stays closed", async () => {
    h.form = { ...missioForm, is_active: false };
    expect((await send("missio-weekly-feedback", {})).status).toBe(403);
    expect(h.handled).toEqual([]);
  });

  it("only that form: another token form, or one tied to an event, stays closed", async () => {
    h.form = { ...missioForm, slug: "something-else" };
    expect((await send("something-else", {})).status).toBe(403);
    h.form = { ...missioForm, event_id: "ev-1" };
    expect((await send("missio-weekly-feedback", {})).status).toBe(403);
    h.form = { ...missioForm, kind: "general" };
    expect((await send("missio-weekly-feedback", {})).status).toBe(403);
    expect(h.handled).toEqual([]);
    expect(h.upserts).toBe(0);
  });
});
