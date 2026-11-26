import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signed: [] as string[],
  doc: null as { id: string; case_id: string; storage_path: string | null } | null,
  logged: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u" } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: async (path: string) => {
          state.signed.push(path);
          return { data: { signedUrl: "https://signed" }, error: null };
        }, }) },
  }),
}));
vi.mock("@/services/visas", () => ({
  getVisaDocumentById: async () => ({ data: state.doc }),
  logVisaCaseEvent: async (_c: unknown, e: Record<string, unknown>) => {
    state.logged.push(e);
    return {};
  },
}));

import { GET } from "./route";

const DOC = "d0000000-0000-0000-0000-000000000001";
const CASE = "c0000000-0000-0000-0000-000000000001";
const OTHER_CASE = "c0000000-0000-0000-0000-000000000002";
const get = (id = DOC) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });

describe("GET /api/visas/documents/[id]", () => {
  beforeEach(() => {
    state.doc = null;
    state.logged = [];
    state.signed = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs a short link and logs the download", async () => {
    state.doc = { id: DOC, case_id: CASE, storage_path: `${CASE}/${DOC}.pdf` };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "https://signed" });
    expect(state.signed).toEqual([`${CASE}/${DOC}.pdf`]);
    expect(state.logged).toEqual([
      { case_id: CASE, actor_id: "u", kind: "document_downloaded", detail: { document_id: DOC } },
    ]);
  });

  it("never signs a path that isn't the row's own", async () => {
    for (const storage_path of [
      `${OTHER_CASE}/${DOC}.pdf`,
      `${CASE}/d0000000-0000-0000-0000-000000000002.pdf`,
      `${CASE}/${DOC}.pdf/../../${OTHER_CASE}/x.pdf`,
      `${CASE}/${DOC}`,
    ]) {
      state.doc = { id: DOC, case_id: CASE, storage_path };
      expect((await get()).status).toBe(404);
    }
    expect(state.signed).toHaveLength(0);
    expect(state.logged).toHaveLength(0);
  });

  it("is refused on a preview, which shares the live database", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    state.doc = { id: DOC, case_id: CASE, storage_path: `${CASE}/${DOC}.pdf` };
    expect((await get()).status).toBe(403);
    expect(state.signed).toHaveLength(0);
    expect(state.logged).toHaveLength(0);
  });

  it("is 404 when RLS hides the row, and logs nothing", async () => {
    expect((await get()).status).toBe(404);
    expect((await get("../etc")).status).toBe(404);
    expect(state.logged).toHaveLength(0);
  });
});
