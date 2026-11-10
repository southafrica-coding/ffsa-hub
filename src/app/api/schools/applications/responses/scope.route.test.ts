import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

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
