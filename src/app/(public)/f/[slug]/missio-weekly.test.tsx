import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// What /f/missio-weekly-feedback hands the browser: the houses (id,
// number, name, meeting date) and the questions without their routes.
// The props of the client component are exactly what gets serialised
// into the page, so checking them is checking the payload.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1" }) }));
vi.mock("@/lib/missio/availability/limit", () => ({ serveAvailabilityLimit: async () => null }));
vi.mock("@/components/missio/weekly/fill", () => ({ WeeklyFeedbackFill: function WeeklyFeedbackFill() { return null; } }));
vi.mock("@/components/missio/weekly/surface", () => ({ GuideStatus: function GuideStatus() { return null; } }));

import { missioWeeklyFeedbackSchema } from "@/lib/forms/templates/missio-weekly-feedback";
import { MissioPublicWeeklyFeedback } from "./missio-weekly";

const ORG = "org-missio";
const H7 = "77777777-7777-4777-8777-777777777777";

function fakeDb() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "order"]) b[op] = () => b;
      b.maybeSingle = async () => ({ data: table === "organisations" ? { id: ORG } : null, error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "house_churches" ? [{ id: H7, number: 7, name: null, meeting_day: "saturday" }] : [], error: null }).then(resolve);
      return b;
    },
  };
}

describe("MissioPublicWeeklyFeedback payload", () => {
  it("passes the questions without routes, and each house with its own meeting date", async () => {
    const stored = missioWeeklyFeedbackSchema();
    const el = (await MissioPublicWeeklyFeedback({ db: fakeDb(), schema: stored })) as ReactElement<Record<string, unknown>>;
    expect((el.type as { name?: string }).name).toBe("WeeklyFeedbackFill");

    const text = JSON.stringify(el.props);
    for (const word of ["routes", "slack", "care_board", "write_column", "open_followup", "create_or_update_contact", '"target"']) {
      expect(text).not.toContain(word);
    }
    // The questions are all still there.
    const steps = (el.props.schema as typeof stored).steps;
    expect(steps.flatMap((s) => s.fields.map((f) => f.key))).toEqual(stored.steps.flatMap((s) => s.fields.map((f) => f.key)));
    // The stored schema handed in is untouched.
    expect(JSON.stringify(stored)).toContain("write_column");

    const houses = (el.props.picker as { houses: Array<Record<string, unknown>> }).houses;
    expect(houses).toHaveLength(1);
    expect(houses[0]).toMatchObject({ id: H7, number: 7, name: null });
    expect(Object.keys(houses[0]).sort()).toEqual(["id", "meetingDate", "name", "number"]);
    // A Saturday house gets a Saturday, never a hard-coded Sunday.
    expect(new Date(`${houses[0].meetingDate}T12:00:00Z`).getUTCDay()).toBe(6);
  });
});
