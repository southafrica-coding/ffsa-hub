import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";
import type { TodayPayload } from "@/lib/mobile/training-today";
import { briefingMessage, sendTrainingBriefing, todayForUser } from "@/lib/training/briefing";

const week = (open: number): TodayPayload => ({
  weekOf: "2026-11-23",
  isoWeek: "2026-W48",
  items: Array.from({ length: open }, (_, i) => ({
    key: `k${i}`,
    kind: "checkin" as const,
    severity: 2 as const,
    title: `Check in with Student ${i + 1}`,
    meta: "14 days since the last one",
    count: null,
    target: { type: "student" as const, enrollmentId: `e${i}` },
    done: false,
  })),
  band: open ? "k0" : null,
  open,
});

describe("briefingMessage", () => {
  it("says all clear in one line when there's nothing", () => {
    const m = briefingMessage("Kim", week(0), "https://hub.test");
    expect(m.text).toBe("Morning Kim ☀️ *Your week in Training*\nAll clear this week 🙌");
    expect(m.blocks).toHaveLength(1);
  });
  it("lists at most six lines and links to Training", () => {
    const m = briefingMessage("Daniel", week(8), "https://hub.test");
    expect(m.text).toContain("• Check in with Student 6 · 14 days since the last one");
    expect(m.text).not.toContain("Student 7");
    expect(m.text).toContain("…and 2 more");
    expect(JSON.stringify(m.blocks)).toContain("https://hub.test/schools");
  });
});

describe("sendTrainingBriefing", () => {
  function admin() {
    return createFakeSupabase({
      resolve: (q: FakeQuery) => {
        if (q.table === "program_leaders") return { data: [{ user_id: "kim" }] };
        if (q.table === "program_staff") return { data: [{ user_id: "paul" }] };
        if (q.table === "enrollment_staff") return { data: [{ user_id: "daniel" }, { user_id: "ruth" }, { user_id: "gone" }] };
        if (q.table === "users" && q.columns?.includes("is_active")) {
          return {
            data: [
              { id: "kim", is_active: true },
              { id: "paul", is_active: true },
              { id: "daniel", is_active: true },
              { id: "ruth", is_active: true },
              { id: "gone", is_active: false },
            ],
          };
        }
        if (q.table === "users") {
          return {
            data: [
              { id: "kim", first_name: "Kim", last_name: "S", preferred_name: null, slack_user_id: "UKIM" },
              { id: "paul", first_name: "Paul", last_name: "B", preferred_name: null, slack_user_id: null },
              { id: "daniel", first_name: "Daniel", last_name: "P", preferred_name: null, slack_user_id: "UDAN" },
              { id: "ruth", first_name: "Ruth", last_name: "M", preferred_name: null, slack_user_id: "URUTH" },
            ],
          };
        }
        if (q.table === "notification_preferences") return { data: [{ user_id: "ruth", muted_modules: ["training"] }] };
        return { data: [] };
      },
    });
  }

  it("DMs each active person their own week, skips the muted, pushes those without Slack", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const slackClient = {
      openConversation: vi.fn(async (id: string) => (id === "UDAN" ? { ok: false } : { ok: true, channel: { id: `D-${id}` } })),
      postMessage: vi.fn(async () => ({ ok: true })),
    };
    const push = vi.fn(async () => ({ sent: 2, failed: 0, revoked: 0 }));
    const build = vi.fn(async (_a: unknown, id: string) => week(id === "paul" ? 0 : 2));
    const run = await sendTrainingBriefing({
      admin: admin().client,
      now: new Date("2026-11-23T05:30:00Z"),
      slackClient: slackClient as never,
      push: push as never,
      build,
    });
    expect(run).toEqual({ recipients: 4, slack: 1, push: 1, muted: 1, failed: 0 });
    expect(build.mock.calls.map((c) => c[1]).sort()).toEqual(["daniel", "kim", "paul"]); // ruth muted, "gone" inactive
    expect(slackClient.postMessage).toHaveBeenCalledTimes(1); // Kim
    // Paul has no Slack and nothing to do: no push. Daniel's Slack refused: push.
    expect(push).toHaveBeenCalledWith(["daniel"], { kind: "training_briefing", key: "training-week:2026-11-23", href: "/schools" });
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("one person failing doesn't stop the others", async () => {
    const build = vi.fn(async (_a: unknown, id: string) => {
      if (id === "kim") throw new Error("boom");
      return week(1);
    });
    const push = vi.fn(async () => ({ sent: 3, failed: 0, revoked: 0 }));
    const run = await sendTrainingBriefing({ admin: admin().client, push: push as never, build });
    expect(run.failed).toBe(1);
    expect(run.push).toBe(2); // no SLACK_BOT_TOKEN: daniel + paul get a push
  });
});

describe("todayForUser", () => {
  it("a walker with no school role reads only their students and no leader tables", async () => {
    const fake = createFakeSupabase({
      resolve: (q: FakeQuery) => {
        if (q.table === "enrollment_staff") return { data: [{ enrollment_id: "e-grace" }] };
        if (q.table === "enrollments") {
          return {
            data: [{ id: "e-grace", user_id: "grace", program_id: "p1", status: "arrived", enrolled_at: null, programs: { name: "FFX" } }],
          };
        }
        if (q.table === "users") return { data: [{ id: "grace", first_name: "Grace", last_name: "M", preferred_name: null }] };
        return { data: [] };
      },
    });
    const out = await todayForUser(fake.client, "daniel", new Date("2026-11-23T05:30:00Z"));
    expect(out.items.map((i) => i.title)).toEqual(["Check in with Grace"]);
    const tables = fake.queries.map((q) => q.table);
    expect(tables).not.toContain("application_responses");
    expect(tables).not.toContain("student_billing_schedule");
    expect(tables).not.toContain("reference_requests");
  });
});
