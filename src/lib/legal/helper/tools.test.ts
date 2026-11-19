import { describe, expect, it } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";
import { LEGAL_HELPER_TOOLS, executeLegalTool } from "./tools";

const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const DRAFT = "44444444-4444-4444-8444-444444444444";
const FILE = "55555555-5555-4555-8555-555555555555";
const ME = "66666666-6666-4666-8666-666666666666";

function fake(resolve: (q: FakeQuery) => { data?: unknown; error?: unknown } | undefined) {
  return createFakeSupabase({ user: { id: ME }, resolve: (q) => resolve(q) ?? { data: null } });
}
const writes = (qs: FakeQuery[]) => qs.filter((q) => q.action !== "select").map((q) => `${q.action}:${q.table}`);

describe("tool definitions", () => {
  it("only reads, plus saving and updating drafts — there is no approve, send or delete tool", () => {
    expect(LEGAL_HELPER_TOOLS.map((t) => t.name).sort()).toEqual(
      ["get_document", "get_overview", "list_drafts", "read_scan", "save_draft", "search_legal", "update_draft"]
    );
  });
  it("every tool is strict: all properties required, no extras, nested too", () => {
    const check = (schema: Record<string, unknown>) => {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      expect(schema.additionalProperties).toBe(false);
      expect([...(schema.required as string[])].sort()).toEqual(Object.keys(props).sort());
      for (const p of Object.values(props)) {
        const items = p.items as Record<string, unknown> | undefined;
        if (items?.type === "object") check(items);
      }
    };
    for (const t of LEGAL_HELPER_TOOLS) {
      expect(t.strict).toBe(true);
      check(t.input_schema as unknown as Record<string, unknown>);
    }
  });
});

describe("save_draft", () => {
  const base = {
    title: "Cover letter",
    kind: "letter",
    folder_id: F1,
    document_id: DOC,
    application_id: null,
    body: "Dear SARS",
    fields: [],
    notes_for_approver: "Check the address",
  };

  it("refuses a document from another folder, and writes nothing", async () => {
    const f = fake((q) => (q.table === "legal_documents" ? { data: { folder_id: F2 } } : undefined));
    const r = await executeLegalTool("save_draft", base, f.client, ME);
    expect((r.output as { error: string }).error).toMatch(/different folder/);
    expect(writes(f.queries)).toEqual([]);
  });

  it("saves a draft waiting for approval, and only a draft", async () => {
    const f = fake((q) => {
      if (q.table === "legal_documents") return { data: { folder_id: F1 } };
      if (q.table === "legal_drafts") return { data: { id: DRAFT, title: "Cover letter", status: "awaiting_approval" } };
    });
    const r = await executeLegalTool("save_draft", base, f.client, ME);
    expect(r.draft).toEqual({ id: DRAFT, title: "Cover letter" });
    expect(r.output).toMatchObject({ saved: true, status: "awaiting approval" });
    expect(writes(f.queries)).toEqual(["insert:legal_drafts"]);
  });

  it("refuses a bad folder id", async () => {
    const f = fake(() => undefined);
    const r = await executeLegalTool("save_draft", { ...base, folder_id: "Personal papers" }, f.client, ME);
    expect((r.output as { error: string }).error).toMatch(/folder_id/);
    expect(writes(f.queries)).toEqual([]);
  });
});

describe("update_draft", () => {
  const change = { draft_id: DRAFT, title: null, body: "New text", fields: null, notes_for_approver: null, folder_id: null, document_id: null };

  it("won't touch an approved draft", async () => {
    const f = fake((q) => (q.table === "legal_drafts" ? { data: { id: DRAFT, folder_id: F1, status: "approved" } } : undefined));
    const r = await executeLegalTool("update_draft", change, f.client, ME);
    expect((r.output as { error: string }).error).toMatch(/approved/);
    expect(writes(f.queries)).toEqual([]);
  });

  it("puts a sent-back draft back in the queue", async () => {
    const f = fake((q) =>
      q.table === "legal_drafts"
        ? { data: q.action === "update" ? { id: DRAFT, title: "Cover letter" } : { id: DRAFT, folder_id: F1, status: "sent_back" } }
        : undefined
    );
    const r = await executeLegalTool("update_draft", change, f.client, ME);
    expect(r.output).toMatchObject({ updated: true, status: "awaiting approval" });
    expect(writes(f.queries)).toEqual(["update:legal_drafts"]);
  });
});

describe("reading", () => {
  it("search words can't break the query syntax", async () => {
    const f = fake(() => ({ data: [] }));
    await executeLegalTool("search_legal", { query: "PBO, (18A)% renewal*" }, f.client, ME);
    const docs = f.queries.find((q) => q.table === "legal_documents")!;
    const or = docs.filters.find((x) => x.op === "or")!.args[0] as string;
    expect(or).toContain("title.ilike.%PBO 18A renewal%");
    expect(or.split(",")).toHaveLength(5);
    expect(filterValue(f.queries.find((q) => q.table === "legal_files")!, "ilike", "extracted_text")).toBe("%PBO 18A renewal%");
  });

  it("a scan that hasn't been read says so", async () => {
    const f = fake((q) => (q.table === "legal_files" ? { data: { id: FILE, extraction_status: "none" } } : undefined));
    const r = await executeLegalTool("read_scan", { file_id: FILE }, f.client, ME);
    expect((r.output as { error: string }).error).toMatch(/hasn't been read/);
  });

  it("nothing visible is reported as not visible, not as missing", async () => {
    const f = fake(() => ({ data: null }));
    const r = await executeLegalTool("get_document", { document_id: DOC }, f.client, ME);
    expect((r.output as { error: string }).error).toMatch(/visible to you/);
  });
});
