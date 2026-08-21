import { describe, expect, it } from "vitest";

import { krProgress, metricCaption, statusTone } from "./progress";

const base = {
  metric_start: null as number | null,
  metric_target: null as number | null,
  current_value: null as number | null,
  metric_unit: null as string | null,
};

describe("krProgress", () => {
  it("returns null when the key result has no metric at all", () => {
    // The common case: most FFSA key results are prose, and must draw no bar.
    expect(krProgress(base)).toBeNull();
  });

  it("returns null until a check-in supplies the current value", () => {
    expect(krProgress({ ...base, metric_start: 0, metric_target: 180 })).toBeNull();
  });

  it("computes a plain rising ratio", () => {
    const p = krProgress({ ...base, metric_start: 0, metric_target: 180, current_value: 90 });
    expect(p?.pct).toBe(50);
  });

  it("measures from the start value, not from zero", () => {
    // 20 of the 80 needed, starting at 100 — not 120/180.
    const p = krProgress({ ...base, metric_start: 100, metric_target: 180, current_value: 120 });
    expect(p?.pct).toBe(25);
  });

  it("handles a counting-down target", () => {
    // "Cut no-shows from 40 to 10": 30 down to 25 is a fifth of the way.
    const p = krProgress({ ...base, metric_start: 40, metric_target: 10, current_value: 34 });
    expect(p?.pct).toBe(20);
  });

  it("clamps overshoot and regression into 0..100", () => {
    expect(krProgress({ ...base, metric_start: 0, metric_target: 10, current_value: 25 })?.pct).toBe(100);
    expect(krProgress({ ...base, metric_start: 0, metric_target: 10, current_value: -5 })?.pct).toBe(0);
  });

  it("marks a met target in yellow", () => {
    expect(krProgress({ ...base, metric_start: 0, metric_target: 10, current_value: 10 })?.tone)
      .toBe("var(--yellow)");
    expect(krProgress({ ...base, metric_start: 0, metric_target: 10, current_value: 9 })?.tone)
      .toBe("#0A0A0A");
  });

  it("returns null when start equals target", () => {
    // The DB CHECK rejects this, but a caller building an unsaved draft can
    // still hand it to us, and 0/0 must not reach the renderer.
    expect(krProgress({ ...base, metric_start: 5, metric_target: 5, current_value: 5 })).toBeNull();
  });

  it("treats zero as a real value, not as missing", () => {
    expect(krProgress({ ...base, metric_start: 0, metric_target: 50, current_value: 0 })?.pct).toBe(0);
  });
});

describe("metricCaption", () => {
  it("is null whenever there is no bar to caption", () => {
    expect(metricCaption(base)).toBeNull();
  });

  it("reads current over target with the unit", () => {
    expect(
      metricCaption({ metric_start: 0, metric_target: 180, current_value: 90, metric_unit: "people" }),
    ).toBe("90 / 180 people");
  });

  it("omits the unit when none was given", () => {
    expect(
      metricCaption({ metric_start: 0, metric_target: 180, current_value: 90, metric_unit: null }),
    ).toBe("90 / 180");
  });
});

describe("statusTone", () => {
  it("reserves amber: stuck is the only alarming tone", () => {
    expect(statusTone("stuck")).toBe("bad");
    expect(statusTone("complete")).toBe("good");
    expect(statusTone("moving_forward")).toBe("good");
    expect(statusTone("not_started")).toBe("quiet");
    expect(statusTone("in_progress")).toBe("quiet");
  });
});
