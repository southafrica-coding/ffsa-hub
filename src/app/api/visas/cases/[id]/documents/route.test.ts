import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "u" } as { id: string } | null,
  visaCase: { id: "case" } as object | null,
  rpcError: null as { code: string; message?: string } | null,
  uploaded: [] as string[],
  removed: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.uploaded.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          state.removed.push(...paths);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/services/visas", () => ({
  getVisaCaseById: async () => ({ data: state.visaCase }),
  addVisaDocument: vi.fn(async () => ({ data: "doc", error: state.rpcError })),
}));

import { POST } from "./route";
import { addVisaDocument } from "@/services/visas";

const CASE = "c0000000-0000-0000-0000-000000000001";
const TYPE = "70000000-0000-0000-0000-000000000001";

function upload(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return POST(new Request("http://localhost/x", { method: "POST", body: form }), {
    params: Promise.resolve({ id: CASE }),
  });
}
const pdf = () => new File(["%PDF-1.4"], "Jane Doe passport.pdf", { type: "application/pdf" });

describe("POST /api/visas/cases/[id]/documents", () => {
  beforeEach(() => {
    state.user = { id: "u" };
    state.visaCase = { id: CASE };
    state.rpcError = null;
    state.uploaded = [];
    state.removed = [];
    vi.mocked(addVisaDocument).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stores the file under case/document ids, never its name", async () => {
    const res = await upload({ file: pdf(), document_type_id: TYPE, issued_on: "2026-10-01" });
    expect(res.status).toBe(200);
    expect(state.uploaded).toHaveLength(1);
    expect(state.uploaded[0]).toMatch(new RegExp(`^${CASE}/[0-9a-f-]{36}\\.pdf$`));
    expect(state.uploaded[0]).not.toMatch(/jane|doe|passport/i);
    expect(vi.mocked(addVisaDocument).mock.calls[0][1]).toMatchObject({
      case_id: CASE,
      document_type_id: TYPE,
      storage_path: state.uploaded[0],
      issued_on: "2026-10-01",
    });
  });

  it("takes the type from the file's bytes, not its name", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])], "scan.pdf", {
      type: "application/pdf",
    });
    expect((await upload({ file: png, document_type_id: TYPE })).status).toBe(200);
    expect(state.uploaded[0]).toMatch(/\.png$/);
    expect(vi.mocked(addVisaDocument).mock.calls[0][1]).toMatchObject({ mime_type: "image/png" });
  });

  it("removes the file when the database refuses it", async () => {
    state.rpcError = { code: "42501" };
    const res = await upload({ file: pdf(), document_type_id: TYPE });
    expect(res.status).toBe(403);
    expect(state.removed).toEqual(state.uploaded);
  });

  it("stores nothing for someone who can't see the case", async () => {
    state.visaCase = null;
    const res = await upload({ file: pdf(), document_type_id: TYPE });
    expect(res.status).toBe(404);
    expect(state.uploaded).toHaveLength(0);
  });

  it("refuses signed-out users, previews and wrong files before storing anything", async () => {
    state.user = null;
    expect((await upload({ file: pdf(), document_type_id: TYPE })).status).toBe(401);
    state.user = { id: "u" };
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await upload({ file: pdf(), document_type_id: TYPE })).status).toBe(403);
    vi.unstubAllEnvs();
    const exe = new File(["MZ"], "x.exe", { type: "application/x-msdownload" });
    expect((await upload({ file: exe, document_type_id: TYPE })).status).toBe(400);
    // A program renamed .pdf, with the PDF type the browser guesses from the name.
    const disguised = new File(["MZ\x90\x00"], "passport.pdf", { type: "application/pdf" });
    expect((await upload({ file: disguised, document_type_id: TYPE })).status).toBe(400);
    expect((await upload({ file: pdf(), document_type_id: "nope" })).status).toBe(400);
    expect((await upload({ file: pdf(), document_type_id: TYPE, issued_on: "2026-02-30" })).status).toBe(400);
    expect(state.uploaded).toHaveLength(0);
  });
});
