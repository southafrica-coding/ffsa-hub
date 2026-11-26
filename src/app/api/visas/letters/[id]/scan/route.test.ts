import { beforeEach, describe, expect, it, vi } from "vitest";

const LETTER = "e0000000-0000-0000-0000-000000000001";
const CASE = "c0000000-0000-0000-0000-000000000001";

const state = vi.hoisted(() => ({
  letter: null as null | Record<string, unknown>,
  caseUser: "student",
  legal: false,
  signed: [] as string[],
  uploaded: [] as string[],
  removed: [] as string[],
  attachError: null as null | { code: string; message: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (p: string) => {
          state.signed.push(p);
          return { data: { signedUrl: "https://signed" }, error: null };
        },
        upload: async (p: string) => {
          state.uploaded.push(p);
          return { error: null };
        },
        remove: async (ps: string[]) => {
          state.removed.push(...ps);
          return { error: null };
        },
      }),
    },
    from: () => ({ insert: async () => ({}) }),
  }),
}));
vi.mock("@/services/visas", () => ({
  getVisaLetterById: async () => ({ data: state.letter }),
  getVisaCaseById: async () => ({ data: { id: CASE, user_id: state.caseUser } }),
  canManageVisaCase: async () => ({ data: state.legal }),
  attachVisaLetterScan: async () => ({ error: state.attachError }),
  logVisaCaseEvent: async () => ({}),
}));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: LETTER }) };
const pdfFile = () => new File([new TextEncoder().encode("%PDF-1.4 scan")], "scan.pdf");
const upload = () => {
  const form = new FormData();
  form.append("file", pdfFile());
  return POST(new Request("http://localhost/x", { method: "POST", body: form }), params);
};

describe("/api/visas/letters/[id]/scan", () => {
  beforeEach(() => {
    state.letter = { id: LETTER, case_id: CASE, status: "signed", scan_path: `${CASE}/${LETTER}.pdf` };
    state.caseUser = "student";
    state.legal = false;
    state.signed = [];
    state.uploaded = [];
    state.removed = [];
    state.attachError = null;
  });

  it("GET: a school leader (not the student, not legal) can't open the signed letter", async () => {
    expect((await GET(new Request("http://localhost/x"), params)).status).toBe(403);
    expect(state.signed).toHaveLength(0);
  });

  it("GET: the student can", async () => {
    state.caseUser = "me";
    expect((await GET(new Request("http://localhost/x"), params)).status).toBe(200);
    expect(state.signed).toEqual([`${CASE}/${LETTER}.pdf`]);
  });

  it("POST: refused before upload unless legal and the student has confirmed", async () => {
    expect((await upload()).status).toBe(403);
    state.legal = true;
    state.letter = { id: LETTER, case_id: CASE, status: "with_student", scan_path: null };
    expect((await upload()).status).toBe(409);
    expect(state.uploaded).toHaveLength(0);
  });

  it("POST: stores at <case>/<letter>.pdf, and removes the file if the database refuses", async () => {
    state.legal = true;
    state.letter = { id: LETTER, case_id: CASE, status: "confirmed", scan_path: null };
    expect((await upload()).status).toBe(200);
    expect(state.uploaded).toEqual([`${CASE}/${LETTER}.pdf`]);
    state.attachError = { code: "P0001", message: "no" };
    expect((await upload()).status).toBe(409);
    expect(state.removed).toEqual([`${CASE}/${LETTER}.pdf`]);
  });
});
