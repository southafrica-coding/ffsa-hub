import { describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

const bounce = {
  to_email: "typo@example.com",
  category: "reference_request",
  status: "bounced",
  bounce_type: "hard",
  source_type: "reference_request",
  source_id: "ref-1",
  created_at: "2026-11-01T00:00:00Z",
  bounced_at: "2026-11-01T00:00:00Z",
  error: "550 user unknown",
};

const admin = createFakeSupabase({
  resolve: (q: FakeQuery) => {
    if (q.table === "email_messages") {
      const status = filterValue(q, "eq", "status");
      return { data: status ? [bounce].filter((m) => m.status === status) : [bounce] };
    }
    if (q.table === "reference_requests") {
      return {
        data: [
          {
            id: "ref-1",
            application_id: "app-1",
            referee_email: "typo@example.com",
            status: "pending",
            email_sent_at: "2026-11-01T00:00:00Z",
          },
        ],
      };
    }
    if (q.table === "application_responses") {
      return {
        data: [
          {
            id: "app-1",
            program_id: "prog-1",
            applicant_info: { first_name: "Sam", last_name: "Lee" },
            programs: { name: "DTS" },
          },
        ],
      };
    }
    return { data: [] };
  },
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => admin.client,
}));

import { getNotifications } from "./notifications";

function userClient(world: PermissionWorld, extra?: (q: FakeQuery) => { data: unknown } | null) {
  return createFakeSupabase({
    user: { id: "me" },
    resolve: (q) => {
      const perm = permissionWorldResolver(world)(q);
      if (perm) return perm;
      return extra?.(q) ?? { data: [] };
    },
  }).client;
}

describe("reference bounce notification", () => {
  it("shows one alert to an admin and none of the bounce diagnostic", async () => {
    const { notifications } = await getNotifications(
      userClient({ roles: [{ id: "r", name: "super_admin" }], direct: [] }),
      "me"
    );
    const alerts = notifications.filter((n) => n.kind === "reference");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("reference-bounce:ref-1");
    expect(alerts[0].title).toBe("Reference email bounced");
    expect(alerts[0].body).toContain("typo@example.com");
    expect(alerts[0].body).not.toContain("550");
    expect(alerts[0].href).toBe("/schools/prog-1");
  });

  it("hides the alert from staff on a different program", async () => {
    const { notifications } = await getNotifications(
      userClient({ roles: [{ id: "r", name: "staff" }], direct: [] }, (q) => {
        if (q.table === "program_leaders") return { data: [{ program_id: "other-program" }] };
        if (q.table === "application_responses") return { data: [] };
        return null;
      }),
      "me"
    );
    expect(notifications.filter((n) => n.kind === "reference")).toEqual([]);
  });
});
