import { beforeEach, describe, expect, it, vi } from "vitest";

// The public weekly feedback link must not show a stranger where the
// answers go. The browser gets the questions only (publicRenderSchema);
// the server still validates and runs every route with the full stored
// schema. Fake database, mocked route runner: nothing reaches Supabase
// or Slack.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
const runRoutes = vi.hoisted(() => vi.fn());
vi.mock("@/lib/forms/route-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/route-runner")>()),
  runFormRoutes: runRoutes,
}));

import { InMemoryRateLimiter } from "@/lib/rate-limit";
import type { FormSchema } from "@/lib/forms/schema";
import { missioWeeklyFeedbackFormRow, missioWeeklyFeedbackSchema } from "@/lib/forms/templates/missio-weekly-feedback";
import { handlePublicWeeklyFeedback, publicRenderSchema } from "./public-feedback";

// Words that only appear in route config, never in a question.
const ROUTING = ["routes", "slack", "care_board", "write_column", "open_followup", "create_or_update_contact", "target", "whenValue"];
const RENDER = ["id", "type", "label", "key", "required", "options", "helpText", "parentFieldId", "showWhenValue", "min", "max", "minLabel", "maxLabel"];

const fields = (s: FormSchema) => s.steps.flatMap((st) => st.fields);

describe("publicRenderSchema", () => {
  const full = missioWeeklyFeedbackSchema();

  it("the template really does route answers (so the test means something)", () => {
    const text = JSON.stringify(full);
    for (const word of ["routes", "slack", "care_board", "write_column", "open_followup", "create_or_update_contact"]) expect(text).toContain(word);
  });

  it("keeps every step and question with what it needs to draw and post it", () => {
    const pub = publicRenderSchema(full);
    expect(pub.steps.map((s) => [s.id, s.title])).toEqual(full.steps.map((s) => [s.id, s.title]));
    expect(fields(pub)).toHaveLength(fields(full).length);
    fields(full).forEach((f, i) => {
      const p = fields(pub)[i];
      for (const k of RENDER) expect((p as Record<string, unknown>)[k]).toEqual((f as Record<string, unknown>)[k]);
    });
    expect(pub.thankYou).toEqual(full.thankYou);
  });

  it("sends no routes, Slack, care board, columns, contacts or follow-ups", () => {
    const pub = publicRenderSchema(full);
    for (const f of fields(pub)) {
      expect(f).not.toHaveProperty("routes");
      for (const k of Object.keys(f)) expect(RENDER).toContain(k);
    }
    const text = JSON.stringify(pub);
    for (const word of ROUTING) expect(text).not.toContain(`"${word}"`);
    for (const word of ROUTING.slice(1, 6)) expect(text).not.toContain(word);
  });

  it("drops anything a field carries that is not a question part, and leaves the stored schema alone", () => {
    const stored = missioWeeklyFeedbackSchema();
    const f0 = stored.steps[0].fields[0] as Record<string, unknown>;
    f0.outcomeId = "outcome-1";
    f0.internalNote = "pastor only";
    (stored as Record<string, unknown>).adminNote = "secret";
    stored.branding = { logoUrl: "https://example.invalid/x.png", accentColor: "#000" };
    const text = JSON.stringify(publicRenderSchema(stored));
    for (const word of ["outcome-1", "pastor only", "secret", "example.invalid"]) expect(text).not.toContain(word);
    // The input still has its routes: only the copy is stripped.
    expect(JSON.stringify(stored)).toContain("write_column");
  });
});

// ────────────────────────────────────────────────────────────
// A valid public submit: full save path, full schema
// ────────────────────────────────────────────────────────────

const ORG = "org-missio";
const H7 = "77777777-7777-4777-8777-777777777777";
const LIVE = { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv;
// Monday 23 Nov 2026, 09:00 SAST. House 7 meets on Saturday: the 21st.
const NOW = new Date("2026-11-23T07:00:00Z");

type Q = { table: string; op: string; payload?: unknown };
let queries: Q[];

function fakeDb() {
  return {
    from(table: string) {
      const q: Q = { table, op: "select" };
      queries.push(q);
      const b: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => (fn(...a), b);
      b.select = chain(() => {});
      b.insert = chain((p) => Object.assign(q, { op: "insert", payload: p }));
      for (const op of ["eq", "order", "maybeSingle", "single"]) b[op] = chain(() => {});
      const data = () => {
        if (table === "organisations") return { id: ORG };
        if (table === "house_churches") return { id: H7, org_id: ORG, number: 7, name: null, meeting_day: "saturday" };
        if (table === "forms") return { id: "form-1", ...missioWeeklyFeedbackFormRow() };
        if (table === "form_submissions") return { id: "sub-1" };
        return null;
      };
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve);
      return b;
    },
  };
}

const answers = {
  attendance: 11,
  first_time_count: 1,
  guest_count: 4,
  member_count: 12,
  invited_count: 3,
  saved_count: 0,
  recommitted_count: 1,
  prophetic_count: 2,
  healing_count: 0,
  deliverance_count: 0,
  win_type: "Deeper friendships and community",
  win_notes: "Two quieter people stayed to talk.",
  challenge_type: "Keeping people connected during the week",
  challenge_notes: "Midweek chat is quiet.",
  connected_score: 4,
  welcome_score: 4,
  activities: ["Worship"],
  leader_score: 4,
  training_needs: ["No help needed right now"],
};

beforeEach(() => {
  queries = [];
  runRoutes.mockReset();
  runRoutes.mockResolvedValue([
    { action: "write_column", status: "done", target: "attendance" },
    { action: "slack", status: "skipped", reason: "slack_disabled", target: "pastors" },
  ]);
});

describe("public submit", () => {
  it("validates and runs the routes with the full stored schema, and answers with no route detail", async () => {
    const req = new Request("http://x/api/f/missio-weekly-feedback/submit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" },
      body: JSON.stringify({ houseId: H7, answers, website: "" }),
    });
    const res = await handlePublicWeeklyFeedback(req, fakeDb(), { env: LIVE, now: NOW, limiter: new InMemoryRateLimiter() });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, meetingDate: "2026-11-21" });

    // Saved for House 7, then the route runner got the stored schema, routes and all.
    const sub = queries.find((q) => q.table === "form_submissions" && q.op === "insert");
    expect(sub?.payload).toMatchObject({ form_id: "form-1", subject_type: "house", subject_id: H7 });
    expect(runRoutes).toHaveBeenCalledTimes(1);
    const [, input] = runRoutes.mock.calls[0];
    const used = JSON.stringify(input.schema);
    for (const word of ["write_column", "slack", "care_board", "open_followup", "create_or_update_contact"]) expect(used).toContain(word);
    expect(input.data).toMatchObject({ attendance: 11, meeting_date: "2026-11-21" });

    // Nothing the runner did comes back to the stranger.
    const text = JSON.stringify(body);
    for (const word of ROUTING) expect(text).not.toContain(word);
  });
});
