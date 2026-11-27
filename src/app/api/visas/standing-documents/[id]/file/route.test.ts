import { beforeEach, describe, expect, it, vi } from "vitest";

const DOC = "d0000000-0000-0000-0000-000000000001";
const OTHER = "d0000000-0000-0000-0000-000000000002";
const CASE = "c0000000-0000-0000-0000-000000000001";

const state = vi.hoisted(() => ({
  legal: false,
  doc: null as null | Record<string, unknown>,
  path: null as unknown,
  pathError: null as null | { code: string; message: string },
  pathArgs: [] as unknown[],
  saveError: null as null | { code: string },
  signed: [] as string[],
  uploaded: [] as string[],
  removed: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } } }) } }),
}));
vi.mock("@/lib/visas/access", () => ({
  getVisaAccess: async () => ({ globalLegal: state.legal }),
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
  }),
}));
vi.mock("@/services/visas", () => ({
  getVisaStandingDocumentById: async () => ({ data: state.doc }),
  getVisaStandingDocumentPath: async (_s: unknown, id: string, caseId: string | null) => {
    state.pathArgs = [id, caseId];
    return { data: state.pathError ? null : state.path, error: state.pathError };
  },
  setVisaStandingDocumentFile: async () => ({ data: state.saveError ? null : { id: DOC }, error: state.saveError }),
}));

import { GET, POST } from "./route";

const params = (id = DOC) => ({ params: Promise.resolve({ id }) });
const get = (query = "", id = DOC) => GET(new Request(`http://localhost/x${query}`), params(id));
const upload = (bytes: string | Uint8Array<ArrayBuffer>) => {
  const form = new FormData();
  form.append("file", new File([typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes], "f"));
  return POST(new Request("http://localhost/x", { method: "POST", body: form }), params());
};
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("/api/visas/standing-documents/[id]/file", () => {
  beforeEach(() => {
    state.legal = false;
    state.doc = { id: DOC, storage_path: null };
    state.path = `standing/${DOC}.pdf`;
    state.pathError = null;
    state.pathArgs = [];
    state.saveError = null;
    state.signed = [];
    state.uploaded = [];
    state.removed = [];
  });

  it("GET: passes the student's case to the database, which decides and logs", async () => {
    expect((await get(`?case=${CASE}`)).status).toBe(200);
    expect(state.pathArgs).toEqual([DOC, CASE]);
    expect(state.signed).toEqual([`standing/${DOC}.pdf`]);
  });

  it("GET: a refusal signs nothing", async () => {
    state.pathError = { code: "42501", message: "Not allowed" };
    expect((await get(`?case=${CASE}`)).status).toBe(403);
    expect(state.signed).toHaveLength(0);
  });

  it("GET: never signs a path that isn't this document's", async () => {
    state.path = `standing/${OTHER}.pdf`;
    expect((await get()).status).toBe(404);
    state.path = `${CASE}/passport.pdf`;
    expect((await get()).status).toBe(404);
    expect(state.signed).toHaveLength(0);
  });

  it("GET: a bad case id is refused before the database", async () => {
    expect((await get("?case=nope")).status).toBe(404);
    expect(state.pathArgs).toEqual([]);
  });

  it("POST: only global legal uploads", async () => {
    expect((await upload("%PDF-1.4")).status).toBe(403);
    expect(state.uploaded).toHaveLength(0);
  });

  it("POST: refuses what isn't a PDF, JPG or PNG", async () => {
    state.legal = true;
    expect((await upload("GIF89a")).status).toBe(400);
    expect(state.uploaded).toHaveLength(0);
  });

  it("POST: stores at standing/<id>.<ext> and removes the old file when the type changes", async () => {
    state.legal = true;
    state.doc = { id: DOC, storage_path: `standing/${DOC}.pdf` };
    expect((await upload(JPG)).status).toBe(200);
    expect(state.uploaded).toEqual([`standing/${DOC}.jpg`]);
    expect(state.removed).toEqual([`standing/${DOC}.pdf`]);
  });

  it("POST: if saving fails, a new file is removed again", async () => {
    state.legal = true;
    state.saveError = { code: "23514" };
    expect((await upload("%PDF-1.4")).status).toBe(500);
    expect(state.removed).toEqual([`standing/${DOC}.pdf`]);
  });
});
