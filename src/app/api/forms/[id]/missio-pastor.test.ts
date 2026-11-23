import { beforeEach, describe, expect, it, vi } from "vitest";

// The one exception to "Hub forms are admin / comms_admin only": a Missio
// pastor may GET and PATCH (name + questions) the Missio weekly feedback
// form, and nothing else. The real helpers in hub-forms-access run here;
// every collaborator under them is a stub, so no database is touched.

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  hubAdmin: false,
  comms: false,
  pastor: true,
  rpcCalls: [] as unknown[],
  form: null as Record<string, unknown> | null,
  updated: [] as unknown[],
  adminUpdates: [] as Array<{ patch: unknown; filters: Array<[string, string, unknown]> }>,
  deleted: [] as string[],
  created: [] as unknown[],
}));

const WEEKLY = {
  id: "weekly-1",
  slug: "missio-weekly-feedback",
  kind: "missio_weekly_feedback",
  event_id: null,
  is_active: true,
  access_mode: "token",
  subject_type: "house",
  schema: { steps: [] },
};
const GENERIC = { id: "generic-1", slug: "dept", kind: "generic", event_id: null, is_active: true, schema: { steps: [] } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push([name, args]);
      return { data: h.pastor, error: null };
    },
  }),
}));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => h.user }));
vi.mock("@/lib/auth/event-route", () => ({ gateEvent: async () => null }));
vi.mock("@/lib/auth/event-access", () => ({
  FORMS_GATE: {},
  FORMS_READ_GATE: {},
  loadEventAccess: async () => ({}),
  isUnscopedAdmin: () => h.hubAdmin,
  hasUnscopedRole: () => h.comms,
  writeBlocked: (error: unknown, data: unknown) => !error && !data,
}));
vi.mock("@/services/forms", () => ({
  generateUniqueFormSlug: async () => "new",
  createForm: async (_s: unknown, row: unknown) => {
    h.created.push(row);
    return { data: { id: "new" }, error: null };
  },
  getFormById: async (_s: unknown, id: string) => ({ data: h.form && h.form.id === id ? h.form : null, error: null }),
  updateForm: async (_s: unknown, _id: string, patch: unknown) => {
    h.updated.push(patch);
    return { data: { id: "x" }, error: null };
  },
  deleteForm: async (_s: unknown, id: string) => {
    h.deleted.push(id);
    return { data: [{ id }], error: null };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const entry = { patch: undefined as unknown, filters: [] as Array<[string, string, unknown]> };
    const chain = {
      update(patch: unknown) {
        entry.patch = patch;
        h.adminUpdates.push(entry);
        return chain;
      },
      eq(col: string, value: unknown) {
        entry.filters.push(["eq", col, value]);
        return chain;
      },
      is(col: string, value: unknown) {
        entry.filters.push(["is", col, value]);
        return chain;
      },
      select() {
        return chain;
      },
      maybeSingle: async () => ({ data: { ...WEEKLY, ...(entry.patch as object) }, error: null }),
    };
    return { from: (table: string) => (table === "forms" ? chain : null) };
  },
}));

const { GET, PATCH, DELETE } = await import("./route");
const { POST } = await import("../route");
const { canEditMissioWeeklyFeedbackForm, hubFormAccess } = await import("@/lib/auth/hub-forms-access");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new Request(`http://localhost/api/forms/${id}`), ctx(id));
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://localhost/api/forms/${id}`, { method: "PATCH", body: JSON.stringify(body) }), ctx(id));
const del = (id: string) => DELETE(new Request(`http://localhost/api/forms/${id}`, { method: "DELETE" }), ctx(id));

const schema = {
  version: 1,
  branding: {},
  thankYou: { heading: "", message: "" },
  steps: [{ id: "s1", title: "This week", fields: [{ id: "f1", type: "short_text", label: "How was it?", key: "", required: false }] }],
};

beforeEach(() => {
  h.user = { id: "u1" };
  h.hubAdmin = false;
  h.comms = false;
  h.pastor = true;
  h.rpcCalls = [];
  h.form = { ...WEEKLY };
  h.updated = [];
  h.adminUpdates = [];
  h.deleted = [];
  h.created = [];
  vi.unstubAllEnvs();
});

describe("canEditMissioWeeklyFeedbackForm / hubFormAccess", () => {
  const db = { rpc: async () => ({ data: h.pastor, error: null }) };

  it("a Missio pastor: only the weekly feedback form, and only with no event", async () => {
    expect(await canEditMissioWeeklyFeedbackForm(db, "u1", WEEKLY)).toBe(true);
    expect(await hubFormAccess(db, "u1", WEEKLY)).toBe("missio_pastor");
    expect(await canEditMissioWeeklyFeedbackForm(db, "u1", GENERIC)).toBe(false);
    expect(await hubFormAccess(db, "u1", GENERIC)).toBeNull();
    expect(await canEditMissioWeeklyFeedbackForm(db, "u1", { ...WEEKLY, event_id: "e1" })).toBe(false);
  });

  it("asks has_org_role for Missio pastors, and a failed lookup is a no", async () => {
    const calls: unknown[] = [];
    const asking = { rpc: async (...args: unknown[]) => (calls.push(args), { data: true, error: null }) };
    await hubFormAccess(asking, "u1", WEEKLY);
    expect(calls).toEqual([["has_org_role", { p_org_slug: "missio", p_roles: ["pastor"] }]]);
    const failing = { rpc: async () => ({ data: null, error: { message: "down" } }) };
    expect(await hubFormAccess(failing, "u1", WEEKLY)).toBeNull();
  });

  it("coaches and leaders (not pastors) get nothing", async () => {
    h.pastor = false;
    expect(await canEditMissioWeeklyFeedbackForm(db, "u1", WEEKLY)).toBe(false);
    expect(await hubFormAccess(db, "u1", WEEKLY)).toBeNull();
  });

  it("Hub forms admins keep full access, the weekly form included", async () => {
    h.pastor = false;
    h.comms = true;
    expect(await hubFormAccess(db, "u1", GENERIC)).toBe("manage");
    expect(await canEditMissioWeeklyFeedbackForm(db, "u1", WEEKLY)).toBe(true);
  });
});

describe("/api/forms/[id] for a Missio pastor (not a Hub forms admin)", () => {
  it("GET opens the weekly feedback form", async () => {
    const res = await get("weekly-1");
    expect(res.status).toBe(200);
    expect((await res.json()).form.kind).toBe("missio_weekly_feedback");
  });

  it("PATCH saves name and questions through the service role, pinned to this form and kind", async () => {
    const res = await patch("weekly-1", { name: "Weekly feedback", schema });
    expect(res.status).toBe(200);
    expect(h.updated).toEqual([]);
    expect(h.adminUpdates).toHaveLength(1);
    expect(h.adminUpdates[0]?.patch).toEqual({ name: "Weekly feedback", schema });
    expect(h.adminUpdates[0]?.filters).toEqual([
      ["eq", "id", "weekly-1"],
      ["eq", "kind", "missio_weekly_feedback"],
      ["is", "event_id", null],
    ]);
  });

  it("PATCH refuses anything but name and questions, saving nothing", async () => {
    for (const body of [
      { schema, access_mode: "public" },
      { is_active: false },
      { kind: "generic" },
      { slug: "mine" },
      { subject_type: "person" },
      { label_id: "l1" },
      { records_attendance: true },
      { redirect_url: "https://example.org" },
    ]) {
      expect((await patch("weekly-1", body)).status).toBe(403);
    }
    expect((await patch("weekly-1", { name: "  " })).status).toBe(400);
    expect(h.adminUpdates).toEqual([]);
    expect(h.updated).toEqual([]);
  });

  it("PATCH still checks the questions", async () => {
    const bad = structuredClone(schema) as { steps: Array<{ fields: Array<Record<string, unknown>> }> };
    bad.steps[0]!.fields[0]!.routes = [{ action: "slack", target: "", when: "in", whenValue: [1] }];
    expect((await patch("weekly-1", { schema: bad })).status).toBe(400);
    expect(h.adminUpdates).toEqual([]);
  });

  it("DELETE of the weekly form is refused", async () => {
    expect((await del("weekly-1")).status).toBe(403);
    expect(h.deleted).toEqual([]);
  });

  it("any other Hub form: GET, PATCH and DELETE are refused", async () => {
    h.form = { ...GENERIC };
    expect((await get("generic-1")).status).toBe(403);
    expect((await patch("generic-1", { schema })).status).toBe(403);
    expect((await del("generic-1")).status).toBe(403);
    expect(h.adminUpdates).toEqual([]);
    expect(h.updated).toEqual([]);
    expect(h.deleted).toEqual([]);
  });

  it("can't create a form (POST /api/forms)", async () => {
    const res = await POST(new Request("http://localhost/api/forms", { method: "POST", body: JSON.stringify({ name: "Mine" }) }));
    expect(res.status).toBe(403);
    expect(h.created).toEqual([]);
  });

  it("a preview deployment saves nothing, pastor or not", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await patch("weekly-1", { schema })).status).toBe(403);
    expect(h.adminUpdates).toEqual([]);
  });
});

describe("/api/forms/[id] for coaches, leaders and admins", () => {
  it("a coach or leader (no pastor role) is refused the weekly form", async () => {
    h.pastor = false;
    expect((await get("weekly-1")).status).toBe(403);
    expect((await patch("weekly-1", { schema })).status).toBe(403);
    expect(h.adminUpdates).toEqual([]);
  });

  it("a Hub forms admin edits as before, on their own client, and can still delete", async () => {
    h.pastor = false;
    h.hubAdmin = true;
    expect((await patch("weekly-1", { name: "Renamed", schema })).status).toBe(200);
    expect(h.updated).toEqual([{ name: "Renamed", schema }]);
    expect(h.adminUpdates).toEqual([]);
    h.form = { ...GENERIC };
    expect((await get("generic-1")).status).toBe(200);
    expect((await del("generic-1")).status).toBe(200);
  });
});
