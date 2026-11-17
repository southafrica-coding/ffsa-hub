import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import { REFERENCE_REQUEST_COLUMN_LIST } from "@/lib/references/reference-request-columns";
import { SELF_REFEREE_MESSAGE } from "@/lib/references/self-referee";
import { createReferenceRequest, updateReferenceRequest } from "./schools";

function clientFor(opts: {
  applicantEmail?: string | null;
  infoEmail?: string | null;
  userEmail?: string | null;
  userId?: string | null;
  authEmail?: string | null;
}) {
  const fake = createFakeSupabase({
    resolve: (q) => {
      if (q.table === "application_responses" && q.action === "select") {
        return {
          data: {
            applicant_email: opts.applicantEmail ?? null,
            applicant_info: opts.infoEmail ? { email: opts.infoEmail } : null,
            user_id: opts.userId ?? null,
            users: opts.userEmail ? { email: opts.userEmail } : null,
          },
        };
      }
      if (q.table === "reference_requests" && q.action === "select") {
        return { data: { application_id: "app-1" } };
      }
      if (q.action === "insert" || q.action === "update") {
        return { data: { id: "ref-1", referee_email: "stored@example.com" } };
      }
      return { data: null };
    },
  });
  fake.client.auth.admin = {
    getUserById: async () => ({
      data: { user: { email: opts.authEmail ?? null } },
      error: null,
    }),
  };
  return fake;
}

function writes(fake: ReturnType<typeof clientFor>) {
  return fake.queries.filter((q) => q.action === "insert" || q.action === "update");
}

describe("createReferenceRequest self-referee guard", () => {
  it("rejects the applicant email before insert", async () => {
    const fake = clientFor({ applicantEmail: "ada@example.com" });
    const result = await createReferenceRequest(fake.client, {
      application_id: "app-1",
      slot_id: "slot-1",
      referee_name: "Ada",
      referee_email: " Ada@Example.com ",
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe(SELF_REFEREE_MESSAGE);
    expect(writes(fake)).toEqual([]);
  });

  it("rejects applicant_info.email, the users email, and the auth email", async () => {
    for (const opts of [
      { infoEmail: "info@example.com" },
      { userEmail: "user@example.com", userId: "user-1" },
      { userId: "user-1", authEmail: "auth@example.com" },
    ]) {
      const email =
        opts.infoEmail ?? opts.userEmail ?? opts.authEmail ?? "";
      const fake = clientFor(opts);
      const result = await createReferenceRequest(fake.client, {
        application_id: "app-1",
        slot_id: "slot-1",
        referee_name: "Ada",
        referee_email: email.toUpperCase(),
      });
      expect(result.error?.message).toBe(SELF_REFEREE_MESSAGE);
      expect(writes(fake)).toEqual([]);
    }
  });

  it("still inserts a different email, including a plus-tag", async () => {
    const fake = clientFor({ applicantEmail: "ada@example.com", userId: "user-1", authEmail: "auth@example.com" });
    const result = await createReferenceRequest(fake.client, {
      application_id: "app-1",
      slot_id: "slot-1",
      referee_name: "Pastor",
      referee_email: "ada+ref@example.com",
    });
    expect(result.error).toBeNull();
    expect(writes(fake).map((q) => q.action)).toEqual(["insert"]);
    expect(writes(fake)[0].columns).toBe(
      "id, application_id, slot_id, referee_name, referee_email, status, token"
    );
  });
});

describe("updateReferenceRequest self-referee guard", () => {
  it("rejects a self email before update", async () => {
    const fake = clientFor({ applicantEmail: "ada@example.com" });
    const result = await updateReferenceRequest(fake.client, "ref-1", {
      referee_name: "Ada",
      referee_email: "ada@example.com",
    });
    expect(result.error?.message).toBe(SELF_REFEREE_MESSAGE);
    expect(writes(fake)).toEqual([]);
  });

  it("still updates a different email", async () => {
    const fake = clientFor({ applicantEmail: "ada@example.com" });
    const result = await updateReferenceRequest(fake.client, "ref-1", {
      referee_email: "pastor@example.com",
    });
    expect(result.error).toBeNull();
    expect(writes(fake).map((q) => q.action)).toEqual(["update"]);
    expect(writes(fake)[0].columns).toBe(REFERENCE_REQUEST_COLUMN_LIST);
  });
});
