import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/forms (create a Hub form) and PATCH /api/forms/[id] (save the
// builder). Every collaborator is a stub: no database is touched.

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  canManage: true,
  isAdmin: true,
  form: { id: "form-1", event_id: null as string | null, schema: {} },
  created: [] as unknown[],
  updated: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => h.user }));
vi.mock("@/lib/auth/hub-forms-access", () => ({ canManageHubForms: async () => h.canManage }));
vi.mock("@/lib/auth/event-route", () => ({ gateEvent: async () => null }));
vi.mock("@/lib/auth/event-access", () => ({
  FORMS_GATE: {},
  FORMS_READ_GATE: {},
  loadEventAccess: async () => ({}),
  isUnscopedAdmin: () => h.isAdmin,
  hasUnscopedRole: () => false,
  writeBlocked: () => false,
}));
vi.mock("@/services/forms", () => ({
  generateUniqueFormSlug: async (_s: unknown, name: string) => name.toLowerCase().replace(/\s+/g, "-"),
  createForm: async (_s: unknown, row: unknown) => {
    h.created.push(row);
    return { data: { id: "new-form", ...(row as object) }, error: null };
  },
  getFormById: async () => ({ data: h.form, error: null }),
  updateForm: async (_s: unknown, _id: string, patch: unknown) => {
    h.updated.push(patch);
    return { data: { id: "form-1" }, error: null };
  },
  deleteForm: async () => ({ data: [{ id: "form-1" }], error: null }),
}));

const { POST } = await import("./route");
const { PATCH } = await import("./[id]/route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/forms", { method: "POST", body: JSON.stringify(body) }));
const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/forms/form-1", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "form-1" }),
  });

const goodSchema = {
  version: 1,
  branding: {},
  thankYou: { heading: "", message: "" },
  steps: [
    {
      id: "s1",
      title: "One",
      fields: [
        {
          id: "f1",
          type: "linear_scale",
          label: "Leader",
          key: "",
          required: true,
          min: 1,
          max: 5,
          routes: [{ action: "slack", target: "house coach", when: "in", whenValue: [1, 2] }],
        },
      ],
    },
  ],
};

beforeEach(() => {
  h.user = { id: "u1" };
  h.canManage = true;
  h.isAdmin = true;
  h.form = { id: "form-1", event_id: null, schema: {} };
  h.created = [];
  h.updated = [];
  vi.unstubAllEnvs();
});

describe("POST /api/forms", () => {
  it("401 signed out, 403 without admin or comms_admin", async () => {
    h.user = null;
    expect((await post({ name: "X" })).status).toBe(401);
    h.user = { id: "u1" };
    h.canManage = false;
    expect((await post({ name: "X" })).status).toBe(403);
    expect(h.created).toEqual([]);
  });

  it("creates a draft generic form with no event", async () => {
    const res = await post({ name: "Department request", access_mode: "logged_in" });
    expect(res.status).toBe(200);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({
      name: "Department request",
      slug: "department-request",
      event_id: null,
      is_active: false,
      kind: "generic",
      access_mode: "logged_in",
    });
  });

  it("refuses token links (F4) and a missing name", async () => {
    expect((await post({ name: "Houses", access_mode: "token" })).status).toBe(400);
    expect((await post({ name: "  " })).status).toBe(400);
    expect(h.created).toEqual([]);
  });

  it("writes nothing from a preview deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await post({ name: "X" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("preview_writes_disabled");
    expect(h.created).toEqual([]);
  });
});

describe("PATCH /api/forms/[id]", () => {
  it("stores routes[] and a changed access mode", async () => {
    const res = await patch({ schema: goodSchema, access_mode: "public" });
    expect(res.status).toBe(200);
    expect(h.updated[0]).toMatchObject({
      access_mode: "public",
      schema: { steps: [{ fields: [{ routes: [{ action: "slack", when: "in", whenValue: [1, 2] }] }] }] },
    });
  });

  it("rejects a route that could never run, naming the question", async () => {
    const bad = structuredClone(goodSchema);
    bad.steps[0].fields[0].routes = [{ action: "slack", target: "", when: "in", whenValue: [1] }];
    const res = await patch({ schema: bad });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors).toHaveProperty("f1");
    expect(h.updated).toEqual([]);
  });

  it("refuses token mode and access modes on event forms", async () => {
    expect((await patch({ access_mode: "token" })).status).toBe(400);
    h.form = { id: "form-1", event_id: "event-1", schema: {} };
    expect((await patch({ access_mode: "logged_in" })).status).toBe(400);
    expect(h.updated).toEqual([]);
  });

  it("a preview can't change a Hub form, but event forms save as before", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await patch({ name: "Hub" })).status).toBe(403);
    h.form = { id: "form-1", event_id: "event-1", schema: {} };
    expect((await patch({ name: "Event" })).status).toBe(200);
    expect(h.updated).toEqual([{ name: "Event" }]);
  });
});
