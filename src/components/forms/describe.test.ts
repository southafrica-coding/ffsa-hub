import { describe, expect, it } from "vitest";
import { describeField, describeRouteThen, describeRouteWhen, kindOf, routeChip } from "./describe";
import { formatAnswer } from "./form-responses";

describe("builder wording", () => {
  it("describes a scale and a counter", () => {
    expect(
      describeField({ id: "a", type: "linear_scale", label: "", key: "", required: true, minLabel: "Struggling", maxLabel: "Doing great" })
    ).toBe("Linear scale · 1 to 5 · Struggling → Doing great · required");
    expect(describeField({ id: "b", type: "stepper", label: "", key: "", required: false })).toBe(
      "Counter (− and +) · from 0 · optional"
    );
  });

  it("says routes in plain words", () => {
    const r = { action: "slack" as const, target: "house coach", when: "in" as const, whenValue: [1, 2] };
    expect(describeRouteWhen(r)).toBe("When the answer is one of 1 or 2");
    expect(describeRouteThen(r)).toBe("Message someone in Slack · house coach");
    expect(routeChip(r)).toBe("Message someone in Slack · house coach if is 1 or 2");
    expect(routeChip({ action: "store", when: "always" })).toBe("Keep with the response");
  });

  it("event forms are kind event whatever the column says", () => {
    expect(kindOf("generic", "event-1")).toBe("event");
    expect(kindOf(undefined, null)).toBe("generic");
    expect(kindOf("department", null)).toBe("department");
  });

  it("shows scale and counter answers in responses", () => {
    const scale = { id: "s", type: "linear_scale" as const, label: "", key: "score", required: true, maxLabel: "Doing great" };
    expect(formatAnswer(scale, { score: 5 })).toBe("5 of 5 (Doing great)");
    expect(formatAnswer(scale, { score: 3 })).toBe("3 of 5");
    const counter = { id: "c", type: "stepper" as const, label: "", key: "saved", required: true, max: 6, maxLabel: "More than 5" };
    expect(formatAnswer(counter, { saved: 6 })).toBe("More than 5");
    expect(formatAnswer(counter, { saved: 0 })).toBe("0");
  });
});
