import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

const state = vi.hoisted(() => ({
  admin: null as ReturnType<typeof createFakeSupabase> | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin?.client,
}));

vi.mock("@/lib/references/notify-references-complete", () => ({
  maybeNotifyReferencesComplete: async () => {},
}));

vi.mock("@/lib/references/advance-reference-stage", () => ({
  advanceApplicationWhenReferencesComplete: async () => ({ advanced: false }),
}));

import { GET, POST } from "./route";

function row(status: "pending" | "submitted") {
  return {
    id: "ref-1",
    status,
    referee_name: "Pat",
    referee_email: "pat@example.test",
    relationship: null,
    known_duration: null,
    reference_text: null,
    form_data: null,
    submitted_at: status === "submitted" ? "2026-01-02T00:00:00Z" : null,
    email_sent_at: null,
    reminder_sent_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    application_id: "app-1",
    slot_id: "slot-1",
    reference_slots: { label: "Pastor", description: "Knows them" },
    application_responses: {
      id: "app-1",
      program_id: "prog-1",
      user_id: "user-1",
      applicant_email: "ada@example.test",
      applicant_info: { first_name: "Ada", last_name: "Lovelace" },
      programs: { name: "DTS", code: "DTS" },
    },
  };
}

function useAdmin(tokens: Record<string, "pending" | "submitted">) {
  state.admin = createFakeSupabase({
    resolve: (query: FakeQuery) => {
      if (query.table !== "reference_requests") return { data: null };
      const token = filterValue(query, "eq", "token");
      if (typeof token !== "string" || !tokens[token]) {
        return { data: null, error: { message: "not found" } };
      }
      if (query.action === "update") {
        if (tokens[token] !== "pending") return { data: null };
        return { data: row("submitted") };
      }
      return { data: row(tokens[token]) };
    },
  });
  return state.admin;
}

function reads(fake: ReturnType<typeof createFakeSupabase>) {
  return fake.queries.filter((query) => query.table === "reference_requests");
}

describe("/api/public/references", () => {
  beforeEach(() => {
    state.admin = null;
  });

  it("loads a pending reference by the URL token on the admin client", async () => {
    const admin = useAdmin({ good: "pending" });
    const res = await GET(new Request("http://localhost/api/public/references?token=good"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("pending");
    expect(body.referee_name).toBe("Pat");
    expect(body.slot_label).toBe("Pastor");
    expect(body.applicant_name).toBe("Ada Lovelace");
    expect(body.program_name).toBe("DTS");
    expect(JSON.stringify(body)).not.toContain("good");

    const lookup = reads(admin).find((query) => query.action === "select");
    expect(lookup?.columns ?? "").not.toContain("*");
    expect(lookup?.columns ?? "").not.toMatch(/(^|,)\s*token\s*(,|$)/);
    expect(filterValue(lookup!, "eq", "token")).toBe("good");
  });

  it("rejects a missing or unknown token", async () => {
    const missing = await GET(new Request("http://localhost/api/public/references"));
    expect(missing.status).toBe(400);

    const admin = useAdmin({ good: "pending" });
    const res = await GET(new Request("http://localhost/api/public/references?token=nope"));
    expect(res.status).toBe(404);
    expect(reads(admin).some((query) => query.action === "update")).toBe(false);
  });

  it("submits a pending reference and refuses one already used", async () => {
    const pending = useAdmin({ good: "pending" });
    const ok = await POST(
      new Request("http://localhost/api/public/references", {
        method: "POST",
        body: JSON.stringify({
          token: "good",
          answers: [{ question_id: "q1", question_label: "Relationship", answer: "Pastor" }],
        }),
      })
    );
    const okBody = await ok.json();
    expect(ok.status).toBe(200);
    expect(okBody.success).toBe(true);
    expect(JSON.stringify(okBody)).not.toContain("good");
    const update = reads(pending).find((query) => query.action === "update");
    expect(filterValue(update!, "eq", "token")).toBe("good");
    expect(filterValue(update!, "eq", "status")).toBe("pending");
    expect(update?.columns ?? "").not.toContain("token");

    const used = useAdmin({ spent: "submitted" });
    const again = await POST(
      new Request("http://localhost/api/public/references", {
        method: "POST",
        body: JSON.stringify({ token: "spent", reference_text: "no" }),
      })
    );
    expect(again.status).toBe(409);
    expect(reads(used).some((query) => query.action === "update")).toBe(false);

    const bad = useAdmin({});
    const rejected = await POST(
      new Request("http://localhost/api/public/references", {
        method: "POST",
        body: JSON.stringify({ token: "missing" }),
      })
    );
    expect(rejected.status).toBe(404);
    expect(reads(bad).some((query) => query.action === "update")).toBe(false);
  });
});
