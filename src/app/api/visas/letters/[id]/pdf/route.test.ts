import { beforeEach, describe, expect, it, vi } from "vitest";

const LETTER = "e0000000-0000-0000-0000-000000000001";
const CASE = "c0000000-0000-0000-0000-000000000001";

const state = vi.hoisted(() => ({
  passportError: null as null | { code: string },
  logged: [] as Array<Record<string, unknown>>,
  rendered: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "student" } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: async (el: { props: Record<string, unknown> }) => {
    state.rendered.push(el.props);
    return Buffer.from("%PDF-1.4");
  },
}));
vi.mock("@/lib/visas/letter-pdf", () => ({ VisaLetterDocument: () => null }));
vi.mock("@/services/visas", () => ({
  getVisaLetterById: async () => ({
    data: { id: LETTER, case_id: CASE, status: "with_student", body: "Passport {{passport_number}}." },
  }),
  getVisaLetterPassport: async () =>
    state.passportError ? { data: null, error: state.passportError } : { data: "XT1234567", error: null },
  getVisaCaseById: async () => ({ data: { id: CASE, user_id: "student" } }),
  logVisaCaseEvent: async (_c: unknown, e: Record<string, unknown>) => {
    state.logged.push(e);
    return {};
  },
}));

import { GET } from "./route";

const get = () => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: LETTER }) });

describe("GET /api/visas/letters/[id]/pdf", () => {
  beforeEach(() => {
    state.passportError = null;
    state.logged = [];
    state.rendered = [];
  });

  it("gives the student a copy marked for checking, and logs no passport number", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).not.toContain("XT1234567");
    expect(state.rendered[0]).toMatchObject({ text: "Passport XT1234567.", forChecking: true });
    expect(state.logged).toEqual([{ case_id: CASE, actor_id: "student", kind: "letter_opened", detail: { letter_id: LETTER } }]);
    expect(JSON.stringify(state.logged)).not.toContain("XT1234567");
  });

  it("refuses school leaders (the database won't give them the passport) and logs nothing", async () => {
    state.passportError = { code: "42501" };
    expect((await get()).status).toBe(403);
    expect(state.rendered).toHaveLength(0);
    expect(state.logged).toHaveLength(0);
  });
});
