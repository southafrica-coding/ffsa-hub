import { beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  canManage: true,
  canRead: true,
  preview: false,
  sent: 0,
  stamps: 0,
  status: "pending",
  reminderSentAt: null as string | null,
  checkedProgram: null as string | null,
  readId: null as string | null,
  list: null as Array<Record<string, unknown>> | null,
  rows: null as Array<Record<string, any>> | null,
  claimError: null as string | null,
  failIds: new Set<string>(),
  tamperStamp: null as string | null,
  lastOr: null as string | null,
}));

function refRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ref1",
    status: h.status,
    reminder_sent_at: h.reminderSentAt,
    referee_email: "ref@example.com",
    referee_name: "Pat",
    token: "tok",
    application_id: "app1",
    reference_slots: { label: "Pastor" },
    application_responses: {
      id: "app1",
      program_id: "p1",
      applicant_info: { first_name: "Ada", last_name: "Lovelace" },
      programs: { name: "SBI" },
    },
    ...overrides,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
function ensureRows() {
  if (h.rows) return h.rows;
  const seed = h.status === "missing" ? [] : (h.list ?? [refRow()]);
  h.rows = seed.map((row) => ({ ...row }));
  return h.rows;
}

function rowMatches(
  row: Record<string, any>,
  filters: Array<{ type: string; col?: string; val?: unknown; expr?: string }>
) {
  for (const filter of filters) {
    if (filter.type === "eq" && row[filter.col as string] !== filter.val) return false;
    if (filter.type === "neq" && row[filter.col as string] === filter.val) return false;
    if (filter.type === "or") {
      const cutoff = String(filter.expr).match(/reminder_sent_at\.lt\."([^"]+)"/)?.[1];
      const stamp = row.reminder_sent_at as string | null;
      const open = stamp == null || (!!cutoff && stamp < cutoff);
      if (!open) return false;
    }
  }
  return true;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "application_responses") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "app1",
                  program_id: "p1",
                  applicant_email: null,
                  applicant_info: { first_name: "Ada", last_name: "Lovelace" },
                  users: null,
                  programs: { name: "SBI" },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            const found = () => ensureRows().filter((row) => row[col] === val).map((row) => ({ ...row }));
            return {
              single: async () => ({ data: found()[0] ?? null, error: null }),
              then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve({ data: found(), error: null }).then(resolve, reject),
            };
          },
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<{ type: string; col?: string; val?: unknown; expr?: string }> = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push({ type: "eq", col, val });
              return builder;
            },
            neq(col: string, val: unknown) {
              filters.push({ type: "neq", col, val });
              return builder;
            },
            or(expr: string) {
              h.lastOr = expr;
              filters.push({ type: "or", expr });
              return builder;
            },
            select: async () => {
              if (h.claimError && filters.some((filter) => filter.type === "or")) {
                return { data: null, error: { message: h.claimError } };
              }
              const matched = [];
              for (const row of ensureRows()) {
                if (!rowMatches(row, filters)) continue;
                Object.assign(row, patch);
                matched.push({ ...row });
                h.stamps += 1;
              }
              return { data: matched, error: null };
            },
          };
          return builder;
        },
      };
    },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageApplications: async () => h.canManage,
  userCanManageProgram: async (_supabase: unknown, _userId: string, programId: string) => {
    h.checkedProgram = programId;
    return h.canManage;
  },
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async (_supabase: unknown, id: string) => {
    h.readId = id;
    return h.canRead;
  },
  APPLICATIONS_EXPIRED_MESSAGE: "archived",
}));
vi.mock("@/services/schools", () => ({
  updateResponseStatus: async () => ({ data: null, error: null }),
  createResponse: async () => ({ data: null, error: null }),
  getReferenceSlotsByProgram: async () => ({ data: [] }),
  getQuestionsByProgram: async () => ({ data: [] }),
  createReferenceRequest: async () => ({ error: null }),
  setResponseRemoved: async () => ({ error: null }),
  removeEnrollmentForApplicant: async () => {},
  ensureEnrollmentForApplicant: async () => ({ outcome: "enrolled" }),
}));
vi.mock("@/lib/schools/demographics", () => ({ normaliseGender: () => null }));
vi.mock("@/lib/auth/membership-roles", () => ({
  ensureStudentRole: async () => {},
  deactivateMembershipProfile: async () => {},
}));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional: async () => {} }));
vi.mock("@/lib/email/render-program-email", () => ({ resolveProgramEmail: async () => null }));
vi.mock("@/lib/email/send-reference-invite", () => ({ sendReferenceInvite: async () => {} }));
vi.mock("@/lib/email/send-reference-reminder", () => ({
  sendReferenceReminder: async (params: { referenceRequestId?: string }) => {
    h.sent += 1;
    if (h.tamperStamp) {
      const row = ensureRows().find((item) => item.id === params.referenceRequestId);
      if (row) row.reminder_sent_at = h.tamperStamp;
    }
    if (params.referenceRequestId && h.failIds.has(params.referenceRequestId)) {
      return { ok: false, error: "smtp down", suppressed: false };
    }
    return { ok: true, id: "email-1" };
  },
}));
vi.mock("@/lib/email/reference-email", () => ({
  referenceSendConfirmed: (result: { ok?: boolean; id?: string | null }) =>
    result?.ok === true && typeof result.id === "string" && result.id.length > 0,
}));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: async () => {} }));
vi.mock("@/lib/email/templates/application-rejected", () => ({ applicationRejectedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/application-waitlisted", () => ({ applicationWaitlistedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/interview-scheduled", () => ({ interviewScheduledEmailHtml: () => "" }));
vi.mock("@/lib/preview-writes", () => ({
  previewWritesDisabled: () => h.preview,
  previewWriteRefusal: () =>
    h.preview
      ? {
          status: 403 as const,
          body: {
            error: "preview_writes_disabled",
            message: "This preview deployment cannot change school records.",
          },
        }
      : null,
}));

const route = await import("./route");

beforeEach(() => {
  h.canManage = true;
  h.canRead = true;
  h.preview = false;
  h.sent = 0;
  h.stamps = 0;
  h.status = "pending";
  h.reminderSentAt = null;
  h.checkedProgram = null;
  h.readId = null;
  h.list = null;
  h.rows = null;
  h.claimError = null;
  h.failIds = new Set();
  h.tamperStamp = null;
  h.lastOr = null;
});

function patch(body: Record<string, unknown>) {
  return route.PATCH(
    new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );
}

function remindOne() {
  return patch({ action: "send_reference_reminder", reference_request_id: "ref1" });
}

describe("reference reminder", () => {
  it("lets a manager send it once", async () => {
    const res = await remindOne();
    expect(res.status).toBe(200);
    expect(h.sent).toBe(1);
    expect(h.stamps).toBe(1);
    expect(h.checkedProgram).toBe("p1");
    expect(h.readId).toBe("app1");
    expect(h.lastOr).toMatch(/reminder_sent_at\.is\.null,reminder_sent_at\.lt\./);
  });

  it("lets exactly one of two concurrent reminders send", async () => {
    const [first, second] = await Promise.all([remindOne(), remindOne()]);
    expect([first.status, second.status].sort()).toEqual([200, 429]);
    expect(h.sent).toBe(1);
  });

  it("rejects a user without this school's scope", async () => {
    h.canManage = false;
    expect((await remindOne()).status).toBe(403);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("rejects a user who cannot read the application", async () => {
    h.canRead = false;
    expect((await remindOne()).status).toBe(403);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("rejects a submitted reference", async () => {
    h.status = "submitted";
    const res = await remindOne();
    expect(res.status).toBe(409);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("rejects a reminder inside the 24 hour window", async () => {
    h.reminderSentAt = new Date(Date.now() - HOUR).toISOString();
    const res = await remindOne();
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error).toMatch(/23 hours/);
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("allows another reminder once 24 hours have passed", async () => {
    h.reminderSentAt = new Date(Date.now() - 24 * HOUR - 1000).toISOString();
    expect((await remindOne()).status).toBe(200);
    expect(h.sent).toBe(1);
  });

  it("refuses preview mode without sending or stamping", async () => {
    h.preview = true;
    const res = await remindOne();
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("preview_writes_disabled");
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("rolls the stamp back when the send fails, unless a later claim owns it", async () => {
    h.failIds = new Set(["ref1"]);
    const failed = await remindOne();
    expect(failed.status).toBe(500);
    expect(h.sent).toBe(1);
    expect(ensureRows()[0].reminder_sent_at).toBeNull();

    h.sent = 0;
    h.rows = null;
    h.tamperStamp = "later-claim";
    const raced = await remindOne();
    expect(raced.status).toBe(500);
    expect(ensureRows()[0].reminder_sent_at).toBe("later-claim");
  });

  it("does not send when the claim itself fails", async () => {
    h.claimError = "could not claim";
    const res = await remindOne();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/could not claim/);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("returns per-reference results and keeps going after one failure", async () => {
    h.list = [
      refRow({
        id: "ref-open",
        status: "pending",
        reminder_sent_at: new Date(Date.now() - HOUR).toISOString(),
      }),
    ];
    const res = await patch({
      action: "send_outstanding_reference_reminders",
      application_id: "app1",
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toEqual([
      expect.objectContaining({ id: "ref-open", outcome: "cooldown" }),
    ]);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("reports sent, cooldown, not outstanding, and error together", async () => {
    h.failIds = new Set(["ref-bad"]);
    h.list = [
      refRow({ id: "ref-ok", status: "pending", reminder_sent_at: null }),
      refRow({
        id: "ref-cool",
        status: "pending",
        reminder_sent_at: new Date(Date.now() - HOUR).toISOString(),
      }),
      refRow({ id: "ref-done", status: "submitted", reminder_sent_at: null }),
      refRow({ id: "ref-bad", status: "pending", reminder_sent_at: null }),
    ];
    const res = await patch({
      action: "send_outstanding_reference_reminders",
      application_id: "app1",
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results.map((row: { outcome: string }) => row.outcome)).toEqual([
      "sent",
      "cooldown",
      "not_outstanding",
      "error",
    ]);
    expect(h.sent).toBe(2);
    expect(ensureRows().find((row) => row.id === "ref-bad")?.reminder_sent_at).toBeNull();
    expect(ensureRows().find((row) => row.id === "ref-ok")?.reminder_sent_at).toEqual(expect.any(String));
  });

  it("reminds every outstanding reference once and skips one already submitted", async () => {
    h.list = [
      refRow({ id: "ref-open", status: "pending" }),
      refRow({ id: "ref-done", status: "submitted" }),
    ];
    const res = await patch({
      action: "send_outstanding_reference_reminders",
      application_id: "app1",
    });
    expect(res.status).toBe(200);
    expect(h.sent).toBe(1);
    expect(h.stamps).toBe(1);
    expect(h.checkedProgram).toBe("p1");
  });
});
