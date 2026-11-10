import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  allowed: false,
  checks: 0,
  created: 0,
  deleted: 0,
  questionWrites: 0,
  createError: null as { code?: string; message: string } | null,
  questionError: null as { code?: string; message: string } | null,
  deleteResult: {
    data: [{ id: "t1" }] as { id: string }[] | null,
    error: null as { code?: string; message: string } | null,
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));

vi.mock("@/lib/auth/application-template-access", () => ({
  canManageApplicationTemplates: async () => {
    h.checks += 1;
    return h.allowed;
  },
}));

vi.mock("@/services/schools", () => ({
  getApplicationTemplates: async () => ({ data: [{ id: "t1", name: "Standard" }], error: null }),
  getApplicationTemplate: async () => ({
    data: { id: "t1", name: "Standard", application_template_questions: [] },
    error: null,
  }),
  getQuestionsByProgram: async () => ({
    data: [{ id: "q1", label: "Why", parent_question_id: null, sort_order: 0, is_required: true, options: [] }],
    error: null,
  }),
  createApplicationTemplate: async () => {
    h.created += 1;
    return { data: h.createError ? null : { id: "t-new" }, error: h.createError };
  },
  createTemplateQuestion: async () => {
    h.questionWrites += 1;
    return { data: h.questionError ? null : { id: "tq1" }, error: h.questionError };
  },
  deleteApplicationTemplate: async () => {
    h.deleted += 1;
    return h.deleteResult;
  },
  createQuestion: async () => ({ data: { id: "pq1" }, error: null }),
}));

const route = await import("./route");

const FORBIDDEN = "You don't have permission to change application templates.";

beforeEach(() => {
  h.user = { id: "me" };
  h.allowed = false;
  h.checks = 0;
  h.created = 0;
  h.deleted = 0;
  h.questionWrites = 0;
  h.createError = null;
  h.questionError = null;
  h.deleteResult = { data: [{ id: "t1" }], error: null };
});

function save() {
  return route.POST(
    new Request("http://x/api/schools/applications/templates", {
      method: "POST",
      body: JSON.stringify({ action: "save_from_program", program_id: "p1", name: "Standard" }),
    })
  );
}

function importTemplate() {
  return route.POST(
    new Request("http://x/api/schools/applications/templates", {
      method: "POST",
      body: JSON.stringify({ action: "import_to_program", template_id: "t1", program_id: "p1" }),
    })
  );
}

function remove() {
  return route.DELETE(new Request("http://x/api/schools/applications/templates?id=t1"));
}

describe("application template routes", () => {
  it("still lists and applies templates for someone who cannot manage them", async () => {
    const listed = await route.GET();
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ templates: [{ id: "t1", name: "Standard" }] });

    const applied = await importTemplate();
    expect(applied.status).toBe(200);
    expect(h.checks).toBe(0);
    expect(h.created).toBe(0);
  });

  it("refuses save and delete up front when the caller cannot manage templates", async () => {
    const saved = await save();
    expect(saved.status).toBe(403);
    expect(await saved.json()).toEqual({ error: FORBIDDEN });
    expect(h.created).toBe(0);

    const deleted = await remove();
    expect(deleted.status).toBe(403);
    expect(await deleted.json()).toEqual({ error: FORBIDDEN });
    expect(h.deleted).toBe(0);
  });

  it("lets an admin save and delete a template", async () => {
    h.allowed = true;
    expect((await save()).status).toBe(200);
    expect(h.created).toBe(1);

    const deleted = await remove();
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ success: true });
    expect(h.deleted).toBe(1);
  });

  it("maps a Postgres 42501 on create to a 403", async () => {
    h.allowed = true;
    h.createError = { code: "42501", message: "new row violates row-level security policy" };
    const saved = await save();
    expect(saved.status).toBe(403);
    expect(await saved.json()).toEqual({ error: FORBIDDEN });
  });

  it("maps a Postgres 42501 on a template question insert to a 403", async () => {
    h.allowed = true;
    h.questionError = { code: "42501", message: "new row violates row-level security policy" };
    const saved = await save();
    expect(saved.status).toBe(403);
    expect(await saved.json()).toEqual({ error: FORBIDDEN });
    expect(h.questionWrites).toBe(1);
  });

  it("maps a Postgres 42501 on delete to a 403", async () => {
    h.allowed = true;
    h.deleteResult = { data: null, error: { code: "42501", message: "permission denied for table application_templates" } };
    const deleted = await remove();
    expect(deleted.status).toBe(403);
    expect(await deleted.json()).toEqual({ error: FORBIDDEN });
  });

  it("does not report success when a delete affects zero rows", async () => {
    h.allowed = true;
    h.deleteResult = { data: [], error: null };
    const deleted = await remove();
    expect(deleted.status).toBe(403);
    expect(await deleted.json()).toEqual({ error: FORBIDDEN });
    expect(deleted.status).not.toBe(200);
  });

  it("requires a login before the permission check", async () => {
    h.user = null;
    const saved = await save();
    expect(saved.status).toBe(401);
    expect(h.checks).toBe(0);
    expect(h.created).toBe(0);
  });
});
