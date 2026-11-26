import { beforeEach, describe, expect, it, vi } from "vitest";

const SCHOOL_A = "a0000000-0000-0000-0000-00000000000a";
const SCHOOL_B = "b0000000-0000-0000-0000-00000000000b";
const TEMPLATE = "70000000-0000-0000-0000-000000000001";
const CASE = "c0000000-0000-0000-0000-000000000001";

const state = vi.hoisted(() => ({
  template: null as null | { id: string; kind: string; program_id: string | null; status: string; body: string },
  studentError: null as null | { code: string },
  issued: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "legal" } } }) } }),
}));
vi.mock("@/services/visas", () => ({
  getVisaCaseById: async () => ({ data: { id: CASE, user_id: "student", stay_from: "2027-01-10", stay_to: "2027-06-30" } }),
  getVisaLetterTemplateById: async () => ({ data: state.template }),
  getVisaLetterStudent: async () =>
    state.studentError
      ? { data: null, error: state.studentError }
      : { data: { first_name: "Test", last_name: "Student", gender: "Male", nationality: "Testland" }, error: null },
  getVisaCaseSchools: async () => ({
    data: [
      { program_id: SCHOOL_A, start_date: "2027-01-12", end_date: "2027-04-02", programs: { name: "School A" } },
      { program_id: SCHOOL_B, start_date: "2027-04-12", end_date: "2027-06-28", programs: { name: "School B" } },
    ],
  }),
  issueVisaLetter: async (_c: unknown, data: Record<string, unknown>) => {
    state.issued.push(data);
    return { data: "letter-id", error: null };
  },
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: CASE }),
  });

const BODY = "{{letter_date}}\n\nDear {{addressee}}\n\n{{full_name}} ({{passport_number}}) joins {{school_name}} {{school_start}} to {{school_end}}; {{he_she}} leaves {{visa_to}}.";

describe("POST /api/visas/cases/[id]/letters", () => {
  beforeEach(() => {
    state.template = { id: TEMPLATE, kind: "invitation", program_id: SCHOOL_A, status: "current", body: BODY };
    state.studentError = null;
    state.issued = [];
  });

  it("fills the letter in for its own school and keeps the passport a token", async () => {
    const res = await post({ template_id: TEMPLATE, letter_date: "2026-11-24", inputs: { addressee: "The Consul-General" } });
    expect(res.status).toBe(200);
    expect(state.issued).toHaveLength(1);
    expect(state.issued[0].body).toBe(
      "24 November 2026\n\nDear The Consul-General\n\nTest Student ({{passport_number}}) joins School A 12 January 2027 to 2 April 2027; he leaves 30 June 2027."
    );
    expect(state.issued[0].inputs).toEqual({ addressee: "The Consul-General" });
  });

  it("covers every school for a letter that isn't an invitation", async () => {
    state.template = { id: TEMPLATE, kind: "accommodation", program_id: null, status: "current", body: BODY };
    const res = await post({ template_id: TEMPLATE, letter_date: "2026-11-24", inputs: { addressee: "X" }, preview: true });
    expect((await res.json()).text).toContain("joins School A and School B 12 January 2027 to 28 June 2027");
    expect(state.issued).toHaveLength(0);
  });

  it("names the missing details and issues nothing", async () => {
    const res = await post({ template_id: TEMPLATE, letter_date: "2026-11-24", inputs: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ missing: ["Addressed to (e.g. The Ambassador)"] });
    expect(state.issued).toHaveLength(0);
  });

  it("refuses inputs that try to set the student's details or passport", async () => {
    for (const inputs of [{ passport_number: "X1" }, { full_name: "Someone" }]) {
      expect((await post({ template_id: TEMPLATE, letter_date: "2026-11-24", inputs })).status).toBe(400);
    }
    expect(state.issued).toHaveLength(0);
  });

  it("only from the current version", async () => {
    state.template = { id: TEMPLATE, kind: "invitation", program_id: SCHOOL_A, status: "retired", body: BODY };
    expect((await post({ template_id: TEMPLATE, letter_date: "2026-11-24", inputs: { addressee: "X" } })).status).toBe(409);
  });

  it("403 when the caller isn't legal for the case", async () => {
    state.studentError = { code: "42501" };
    expect((await post({ template_id: TEMPLATE, letter_date: "2026-11-24", inputs: { addressee: "X" } })).status).toBe(403);
    state.template = null; // RLS hides templates from non-legal
    expect((await post({ template_id: TEMPLATE, letter_date: "2026-11-24", inputs: { addressee: "X" } })).status).toBe(403);
    expect(state.issued).toHaveLength(0);
  });

  it("400 on a bad date or template id", async () => {
    expect((await post({ template_id: "nope", letter_date: "2026-11-24" })).status).toBe(400);
    expect((await post({ template_id: TEMPLATE, letter_date: "2026-02-30" })).status).toBe(400);
  });
});
