import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/f/[slug]/submit: the preview guard for Hub forms and the hand-off
// to the route runner. Every collaborator is a stub: no database is touched.

const h = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  inserts: [] as Array<{ table: string; row: unknown }>,
  runs: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        h.inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "sub-1" }, error: null }) }) };
      },
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
    }),
  }),
}));
vi.mock("@/services/forms", () => ({ getFormBySlug: async () => ({ data: h.form, error: null }) }));
vi.mock("@/services/contact-upsert", () => ({
  upsertContactWithDedup: async () => ({ data: { action: "created", contactId: "c1" }, error: null }),
}));
vi.mock("@/services/labels", () => ({ addLabelToContact: async () => ({ data: null }) }));
vi.mock("@/services/event-labels", () => ({ applyEventLabelsToContact: async () => undefined }));
vi.mock("@/services/activity-events", () => ({
  logActivity: async () => undefined,
  logLabelAdded: async () => undefined,
  logFormSubmitted: async () => undefined,
}));
vi.mock("@/services/workflows", () => ({
  getActiveWorkflowsForOutcomes: async () => ({ data: [] }),
  getActiveEnrollment: async () => ({ data: null }),
  createEnrollment: async () => ({ data: null }),
}));
vi.mock("@/lib/workflows/runner", () => ({ runEnrollment: async () => undefined }));
vi.mock("@/lib/forms/route-runner", () => ({
  runFormRoutes: async (_db: unknown, input: unknown) => {
    h.runs.push(input);
    return [];
  },
  submissionSubject: () => null,
}));

import { POST } from "./route";

const schema = {
  version: 1,
  branding: {},
  thankYou: { heading: "", message: "" },
  steps: [{ id: "s", title: "", fields: [{ id: "e", type: "email", key: "email", label: "Email", required: true }] }],
};

const send = () =>
  POST(
    new Request("http://x/api/f/f1/submit", { method: "POST", body: JSON.stringify({ data: { email: "a@b.co" } }) }),
    { params: Promise.resolve({ slug: "f1" }) }
  );

beforeEach(() => {
  h.inserts = [];
  h.runs = [];
  h.form = { id: "form-1", slug: "f1", name: "F", is_active: true, event_id: null, label_id: null, schema, access_mode: "public" };
});
afterEach(() => vi.unstubAllEnvs());

describe("Hub form submit", () => {
  it("on a preview: refused, nothing written, no routes run", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await send();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("preview_writes_disabled");
    expect(h.inserts).toEqual([]);
    expect(h.runs).toEqual([]);
  });

  it("on the live site: saves, then runs the routes for that submission", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await send();
    expect(res.status).toBe(200);
    expect(h.inserts.map((i) => i.table)).toEqual(["form_submissions"]);
    expect(h.runs).toEqual([expect.objectContaining({ submissionId: "sub-1", contactId: "c1", data: { email: "a@b.co" } })]);
  });

  it("an event form on a preview keeps working as before (the runner skips its routes)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    h.form = { ...h.form, event_id: "ev-1" };
    const res = await send();
    expect(res.status).toBe(200);
    expect(h.runs).toHaveLength(1);
  });
});
