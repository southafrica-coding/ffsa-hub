import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";
import { careSlackText, notifyNeedsCare } from "@/lib/training/care-notify";

// Needs care goes to the school's leaders and everyone walking with the
// student, never to the author or the student, never with note text, and
// not on Slack or push to anyone who muted "training".

function world() {
  return createFakeSupabase({
    resolve: (q: FakeQuery) => {
      if (q.table === "enrollments") return { data: { id: "e1", user_id: "grace", program_id: "p1" } };
      if (q.table === "program_leaders") return { data: [{ user_id: "kim" }] };
      if (q.table === "enrollment_staff") return { data: [{ user_id: "daniel" }, { user_id: "ruth" }] };
      if (q.table === "users") {
        return {
          data: [
            { id: "kim", first_name: "Kim", last_name: "S", preferred_name: null, slack_user_id: "UKIM" },
            { id: "ruth", first_name: "Ruth", last_name: "M", preferred_name: null, slack_user_id: "URUTH" },
            { id: "daniel", first_name: "Daniel", last_name: "P", preferred_name: null, slack_user_id: "UDAN" },
            { id: "grace", first_name: "Grace", last_name: "M", preferred_name: null, slack_user_id: null },
          ],
        };
      }
      if (q.table === "notification_preferences") return { data: [{ user_id: "ruth", muted_modules: ["training"] }] };
      return { data: [] };
    },
  });
}

describe("notifyNeedsCare", () => {
  it("DMs leaders and co-walkers, skips the author, the student and anyone muted", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const fake = world();
    const posted: Array<{ channel: string; text: string }> = [];
    const slackClient = {
      openConversation: vi.fn(async (id: string) => ({ ok: true, channel: { id: `D-${id}` } })),
      postMessage: vi.fn(async (m: { channel: string; text: string }) => {
        posted.push(m);
        return { ok: true };
      }),
    };
    const push = vi.fn(async () => ({ sent: 1, failed: 0, revoked: 0 }));
    const out = await notifyNeedsCare(
      { checkinId: "c1", enrollmentId: "e1", authorId: "daniel", today: "2026-11-23" },
      { admin: fake.client, push: push as never, slackClient: slackClient as never }
    );
    expect(out.recipients).toBe(2); // kim + ruth (daniel wrote it)
    expect(slackClient.openConversation.mock.calls.map((c) => c[0])).toEqual(["UKIM"]);
    expect(posted[0].text).toBe(careSlackText("Daniel", "Grace"));
    expect(push).toHaveBeenCalledWith(["kim"], { kind: "training_needs_care", key: "training-care:c1", href: "/schools" });
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("never throws", async () => {
    const admin = { from: () => { throw new Error("db down"); } };
    await expect(
      notifyNeedsCare({ checkinId: "c1", enrollmentId: "e1", authorId: "daniel", today: "2026-11-23" }, { admin })
    ).resolves.toEqual({ recipients: 0, slack: 0, push: false });
  });
});
