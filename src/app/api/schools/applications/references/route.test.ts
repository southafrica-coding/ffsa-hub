import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

const editReferenceContact = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, data: { id: "ref" }, emailed: false, emailChanged: false }))
);

const state = vi.hoisted(() => ({
  user: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  admin: null as ReturnType<typeof createFakeSupabase>["client"] | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.user,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
}));
vi.mock("@/lib/references/edit-reference-contact", () => ({
  editReferenceContact,
  REFERENCE_EDIT_SELECT: "*",
}));
vi.mock("@/lib/references/reference-delivery", () => ({
  annotateReferenceDelivery: vi.fn(async () => []),
}));

import { PATCH } from "./route";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function use(opts: {
  scope: "unscoped" | "program-a" | "error";
}) {
  state.user = createFakeSupabase({
    user: { id: "u" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { is_active: true } };
      if (q.table === "application_responses") return { data: { id: "app" } };
      if (q.table === "user_roles") return { data: [] };
      if (q.table === "program_leaders") return { data: [] };
      if (q.table === "user_permissions") {
        const grant = {
          scope_type: opts.scope === "program-a" ? "program" : null,
          scope_id: opts.scope === "program-a" ? A : null,
          permissions: { key: "schools.manage", module: "schools" },
        };
        const wantsNullScope = q.filters.some(
          (f) => f.op === "is" && f.args[0] === "scope_type" && f.args[1] === null
        );
        const scopeType = q.filters.find((f) => f.op === "eq" && f.args[0] === "scope_type")?.args[1];
        const scopeId = q.filters.find((f) => f.op === "eq" && f.args[0] === "scope_id")?.args[1];
        if (wantsNullScope && grant.scope_type !== null) return { data: [] };
        if (scopeType !== undefined && grant.scope_type !== scopeType) return { data: [] };
        if (scopeId !== undefined && grant.scope_id !== scopeId) return { data: [] };
        return { data: [grant] };
      }
      return { data: [] };
    },
  }).client;

  state.admin = createFakeSupabase({
    resolve: (q: FakeQuery) => {
      if (q.table !== "reference_requests") return { data: null };
      if (opts.scope === "error") return { data: null, error: { message: "boom" } };
      const id = filterValue(q, "eq", "id");
      const programId = id === "ref-b" ? B : A;
      return {
        data: {
          id,
          application_id: "app",
          status: "pending",
          referee_name: "Ada",
          referee_email: "ada@example.com",
          application_responses: { program_id: programId },
        },
      };
    },
  }).client;
}

function patch(id: string) {
  return new Request("http://localhost/api/schools/applications/references", {
    method: "PATCH",
    body: JSON.stringify({
      reference_request_id: id,
      referee_name: "Ada",
      referee_email: "ada@example.com",
    }),
  });
}

describe("PATCH /api/schools/applications/references", () => {
  beforeEach(() => {
    editReferenceContact.mockClear();
  });

  it("lets an unscoped schools manager edit a reference", async () => {
    use({ scope: "unscoped" });
    const res = await PATCH(patch("ref-a"));
    expect(res.status).toBe(200);
    expect(editReferenceContact).toHaveBeenCalledOnce();
  });

  it("lets a leader scoped to the reference's program edit it", async () => {
    use({ scope: "program-a" });
    const res = await PATCH(patch("ref-a"));
    expect(res.status).toBe(200);
    expect(editReferenceContact).toHaveBeenCalledOnce();
  });

  it("refuses a leader scoped to a different program", async () => {
    use({ scope: "program-a" });
    const res = await PATCH(patch("ref-b"));
    expect(res.status).toBe(403);
    expect(editReferenceContact).not.toHaveBeenCalled();
  });

  it("refuses when the program lookup errors", async () => {
    use({ scope: "error" });
    const res = await PATCH(patch("ref-a"));
    expect(res.status).toBe(403);
    expect(editReferenceContact).not.toHaveBeenCalled();
  });
});
