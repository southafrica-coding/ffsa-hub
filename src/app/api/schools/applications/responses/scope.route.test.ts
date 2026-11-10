import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

const setResponseRemoved = vi.hoisted(() => vi.fn(async () => ({ data: { id: "a" }, error: null })));

const state = vi.hoisted(() => ({
  user: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  rows: [] as Array<{ id: string; program_id: string }>,
  error: false,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      const selected: { ids?: string[] } = {};
      const q: Record<string, unknown> = {
        select() { return q; },
        in(_col: string, ids: string[]) { selected.ids = ids; return q; },
        eq() { return q; },
        insert() { return Promise.resolve({ error: null }); },
        delete() { return q; },
        single() { return Promise.resolve(payload()); },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(payload()).then(resolve); },
      };
      function payload() {
        if (state.error) return { data: null, error: { message: "boom" } };
        const data = state.rows.filter((row) => !selected.ids || selected.ids.includes(row.id));
        return { data, error: null };
      }
      return q;
    },
  }),
}));
vi.mock("@/services/schools", () => ({
  createResponse: vi.fn(),
  updateResponseStatus: vi.fn(),
  getReferenceSlotsByProgram: vi.fn(),
  getQuestionsByProgram: vi.fn(),
  createReferenceRequest: vi.fn(),
  setResponseRemoved,
  removeEnrollmentForApplicant: vi.fn(),
  ensureEnrollmentForApplicant: vi.fn(),
}));
vi.mock("@/lib/auth/membership-roles", () => ({
  ensureStudentRole: vi.fn(),
  deactivateMembershipProfile: vi.fn(),
}));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional: vi.fn() }));
vi.mock("@/lib/email/render-program-email", () => ({ resolveProgramEmail: vi.fn() }));
vi.mock("@/lib/email/send-reference-invite", () => ({ sendReferenceInvite: vi.fn() }));
vi.mock("@/lib/email/send-reference-reminder", () => ({ sendReferenceReminder: vi.fn() }));
vi.mock("@/lib/email/reference-email", () => ({ referenceSendConfirmed: vi.fn() }));
vi.mock("@/lib/references/reminder-claim", () => ({ claimThenSendReferenceReminder: vi.fn() }));
vi.mock("@/lib/preview-writes", () => ({ previewWriteRefusal: vi.fn(() => null) }));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: vi.fn() }));
vi.mock("@/lib/email/templates/application-rejected", () => ({ applicationRejectedEmailHtml: vi.fn() }));
vi.mock("@/lib/email/templates/application-waitlisted", () => ({ applicationWaitlistedEmailHtml: vi.fn() }));
vi.mock("@/lib/email/templates/interview-scheduled", () => ({ interviewScheduledEmailHtml: vi.fn() }));

import { DELETE, PATCH } from "./route";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function leader(active = true) {
  state.user = createFakeSupabase({
    user: { id: "u" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { is_active: active } };
      if (q.table === "user_roles") {
        return { data: [{ scope_type: "program", scope_id: A, roles: { name: "program_leader" } }] };
      }
      if (q.table === "application_responses") return { data: { id: "own" } };
      return { data: [] };
    },
  }).client;
}

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/schools/applications/responses", {
    method,
    body: JSON.stringify(body),
  });
}

describe("application archive and delete gates", () => {
  beforeEach(() => {
    state.error = false;
    state.rows = [
      { id: "own", program_id: A },
      { id: "other", program_id: B },
    ];
    setResponseRemoved.mockClear();
    leader();
  });

  it("lets a scoped leader archive an application in their program", async () => {
    const res = await PATCH(req("PATCH", { action: "archive", id: "own" }));
    expect(res.status).toBe(200);
    expect(setResponseRemoved).toHaveBeenCalled();
  });

  it("refuses another program", async () => {
    const res = await DELETE(req("DELETE", { id: "other" }));
    expect(res.status).toBe(403);
  });

  it("refuses a mixed batch", async () => {
    const res = await PATCH(req("PATCH", { action: "archive", id: "own", ids: ["own", "other"] }));
    expect(res.status).toBe(403);
    expect(setResponseRemoved).not.toHaveBeenCalled();
  });

  it("refuses a deactivated leader", async () => {
    leader(false);
    const res = await PATCH(req("PATCH", { action: "restore", id: "own" }));
    expect(res.status).toBe(403);
    expect(setResponseRemoved).not.toHaveBeenCalled();
  });

  it("refuses when the application lookup errors", async () => {
    state.error = true;
    const res = await DELETE(req("DELETE", { id: "own" }));
    expect(res.status).toBe(403);
  });
});

type Persona = "manage" | "approve" | "enrollments" | "leader-row" | "role";

function persona(kind: Persona) {
  const key =
    kind === "manage"
      ? "schools.manage"
      : kind === "approve"
        ? "schools.approve_applications"
        : "schools.manage_enrollments";
  state.user = createFakeSupabase({
    user: { id: "u" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { is_active: true } };
      if (q.table === "user_roles" && kind === "role") {
        return { data: [{ role_id: "pl", scope_type: "program", scope_id: A, roles: { name: "program_leader" } }] };
      }
      if (q.table === "user_permissions" && (kind === "manage" || kind === "approve" || kind === "enrollments")) {
        if (q.filters.some((f) => f.op === "is" && f.args[0] === "scope_type")) return { data: [] };
        const scopeId = filterValue(q, "eq", "scope_id");
        if (scopeId && scopeId !== A) return { data: [] };
        return { data: [{ scope_type: "program", scope_id: A, permissions: { key } }] };
      }
      if (q.table === "program_leaders" && kind === "leader-row") {
        const programId = filterValue(q, "eq", "program_id");
        if (programId && programId !== A) return { data: [] };
        return { data: [{ id: "pl" }] };
      }
      if (q.table === "application_responses") return { data: { id: "own", status: "submitted" } };
      if (q.table.startsWith("rpc:")) return { data: false };
      return { data: [] };
    },
  }).client;
}

describe("scoped managers on their own program", () => {
  beforeEach(() => {
    state.error = false;
    state.rows = [
      { id: "own", program_id: A },
      { id: "other", program_id: B },
    ];
    setResponseRemoved.mockClear();
  });

  it.each(["manage", "approve", "enrollments", "leader-row", "role"] as Persona[])(
    "lets a %s holder archive their program and refuses another",
    async (kind) => {
      persona(kind);
      expect((await PATCH(req("PATCH", { action: "archive", id: "own" }))).status).toBe(200);
      expect((await PATCH(req("PATCH", { action: "restore", id: "other" }))).status).toBe(403);
      expect((await PATCH(req("PATCH", { action: "archive", id: "other" }))).status).toBe(403);
    }
  );

  it("lets schools.manage and approve_applications delete their own application", async () => {
    persona("manage");
    expect((await DELETE(req("DELETE", { id: "own" }))).status).toBe(200);
    expect((await DELETE(req("DELETE", { id: "other" }))).status).toBe(403);
    persona("approve");
    expect((await DELETE(req("DELETE", { id: "own" }))).status).toBe(200);
  });

  it("refuses delete for a program_leaders row, manage_enrollments, and a program_leader role", async () => {
    for (const kind of ["enrollments", "leader-row", "role"] as Persona[]) {
      persona(kind);
      expect((await DELETE(req("DELETE", { id: "own" }))).status).toBe(403);
    }
  });
});
