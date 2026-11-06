import { ApiError } from "@/lib/api";

import {
  STATUS_OPTIONS,
  buildCheckin,
  cacheName,
  formatDay,
  isNotFound,
  loadErrorMessage,
  saveErrorMessage,
  statusLabel,
  statusTally,
  statusTone,
  webPath,
} from "../logic";
import { strings } from "../strings";

describe("status words and tones", () => {
  it("match the website's labels and tones (never colour alone: the word is always there)", () => {
    expect(statusLabel("moving_forward")).toBe("Moving forward");
    expect(statusTone("complete")).toBe("positive");
    expect(statusTone("moving_forward")).toBe("positive");
    expect(statusTone("stuck")).toBe("danger");
    expect(statusTone("in_progress")).toBe("default");
    expect(statusTone("not_started")).toBe("default");
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(["not_started", "in_progress", "moving_forward", "stuck", "complete"]);
  });

  it("tallies only the non-zero statuses, in a fixed order", () => {
    expect(statusTally({ not_started: 0, in_progress: 2, moving_forward: 0, stuck: 1, complete: 3 })).toEqual([
      { status: "in_progress", count: 2, text: "2 In progress" },
      { status: "stuck", count: 1, text: "1 Stuck" },
      { status: "complete", count: 3, text: "3 Complete" },
    ]);
  });
});

describe("buildCheckin", () => {
  it("prose key results never send a figure", () => {
    expect(buildCheckin({ status: "stuck", value: "12", comment: "  ", hasMetric: false })).toEqual({
      ok: true,
      body: { status: "stuck", value: null, comment: null },
    });
  });

  it("tracked key results send a number; blank means no new figure", () => {
    expect(buildCheckin({ status: "in_progress", value: " 120 ", comment: "More came", hasMetric: true })).toEqual({
      ok: true,
      body: { status: "in_progress", value: 120, comment: "More came" },
    });
    expect(buildCheckin({ status: "in_progress", value: "", comment: "", hasMetric: true })).toEqual({
      ok: true,
      body: { status: "in_progress", value: null, comment: null },
    });
  });

  it("accepts a comma decimal and a negative, refuses words", () => {
    expect(buildCheckin({ status: "complete", value: "4,5", comment: "", hasMetric: true })).toMatchObject({ body: { value: 4.5 } });
    expect(buildCheckin({ status: "complete", value: "-2", comment: "", hasMetric: true })).toMatchObject({ body: { value: -2 } });
    expect(buildCheckin({ status: "complete", value: "about 10", comment: "", hasMetric: true })).toEqual({
      ok: false,
      error: strings.errors.valueNotNumber,
    });
  });
});

describe("errors in words", () => {
  it("load errors", () => {
    expect(loadErrorMessage(new ApiError("network", "x"))).toBe(strings.common.network);
    expect(loadErrorMessage(new ApiError("timeout", "x"))).toBe(strings.common.network);
    expect(loadErrorMessage(new ApiError("forbidden", "x", 403))).toBe(strings.common.forbidden);
    expect(loadErrorMessage(new Error("?"))).toBe(strings.common.generic);
  });

  it("save errors keep the next step in the sentence", () => {
    expect(saveErrorMessage(new ApiError("network", "x"))).toBe(strings.errors.saveNetwork);
    expect(saveErrorMessage(new ApiError("forbidden", "x", 403))).toBe(strings.errors.saveForbidden);
    expect(saveErrorMessage(new ApiError("http", "x", 500))).toBe(strings.errors.saveGeneric);
  });

  it("404 is 'not found', nothing else is", () => {
    expect(isNotFound(new ApiError("http", "x", 404))).toBe(true);
    expect(isNotFound(new ApiError("http", "x", 500))).toBe(false);
    expect(isNotFound(new Error("404"))).toBe(false);
  });
});

describe("dates, paths and offline copies", () => {
  it("formats a day", () => {
    expect(formatDay("2026-03-01")).toBe("1 Mar 2026");
    expect(formatDay("2026-12-31T10:00:00Z")).toBe("31 Dec 2026");
    expect(formatDay("soon")).toBe("soon");
    expect(formatDay(null)).toBe("");
  });

  it("builds website paths", () => {
    expect(webPath(null, null)).toBe("/okrs");
    expect(webPath(null, "2025")).toBe("/okrs?cycle=2025");
    expect(webPath("abc", "2026 q1")).toBe("/okrs/abc?cycle=2026%20q1");
  });

  it("keeps one offline copy per cycle and group", () => {
    expect(cacheName(null, null)).toBe("okrs.wall.current");
    expect(cacheName(null, "2025")).toBe("okrs.wall.2025");
    expect(cacheName("abc", null)).toBe("okrs.owner.abc.current");
  });
});
