// The inspection's pure logic: the draft, the step-by-step route, measurement grading,
// what a save stores and changes on the vehicle, what a delete recalculates, and the
// report text. guidedSteps, autoStatus and tickDraft are also run against the reference
// app's own functions (vehicles-module/app/ffsa-fleet.html).

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { seedFleetData } from "./testing/seed";
import { checklistIndex, inType, itemsFor, profileOf, TIME_CAP_MS, type FleetVehicle } from "./rules";
import {
  autoStatus,
  buildInspection,
  draftKey,
  guidedStages,
  guidedSteps,
  inspectionFromRow,
  inspectionToRow,
  loadDraft,
  newDraft,
  newerDraft,
  recomputeVehicle,
  reportText,
  tickDraft,
  toNum,
  vehiclePatchAfterSave,
  type Inspection,
} from "./inspection";

const TODAY = "2026-11-17";
const F = seedFleetData(TODAY);
const cl = F.checklist;
const veh = (id: string) => F.vehicles.find((v) => v.id === id)! as FleetVehicle;

// The reference app's own functions, run in a sandbox with this checklist.
const html = fs.readFileSync(path.resolve(__dirname, "../../../vehicles-module/app/ffsa-fleet.html"), "utf8");
const grab = (start: string, end: string) => {
  const i = html.indexOf(start);
  const j = html.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error("marker " + start);
  return html.slice(i, j);
};
function appFns(hasAttn: boolean) {
  const ctx: Record<string, unknown> = {
    profileOf,
    IX: () => checklistIndex(cl),
    itemsFor: (t: string) => itemsFor(cl, t),
    inType,
    attentionFor: () => (hasAttn ? [{}] : []),
    has: (v: unknown) => v !== null && v !== undefined && v !== "",
    S: { draft: null },
    __now: 0,
  };
  ctx.Date = { now: () => ctx.__now };
  vm.createContext(ctx);
  vm.runInContext(
    [
      grab("const ROUTE = [", "\n];") + "\n];",
      grab("function guidedSteps", "function guidedHTML"),
      grab("function toNum", "function toKm"),
      grab("function autoStatus", "async function saveInspection"),
      grab("const TIME_CAP_MS", "function logTime"),
      "globalThis.__api = { guidedSteps, autoStatus, tickDraft, S, setNow: (n) => { globalThis.__now = n; } };",
    ].join("\n"),
    ctx
  );
  return ctx.__api as {
    guidedSteps: (type: string, v: FleetVehicle) => unknown[];
    autoStatus: (it: unknown, val: unknown) => string | null;
    tickDraft: () => void;
    setNow: (n: number) => void;
    S: { draft: { activeMs?: number; tick?: number } | null };
  };
}

describe("draft", () => {
  it("is kept under the key the vehicle page checks", () => {
    expect(draftKey("abc")).toBe("ffsa-fleet-draft-abc");
  });

  it("pre-marks the points the model doesn't have as N/A", () => {
    const d = newDraft(veh("almera"), "weekly", TODAY, "Jack", 1000);
    expect(Object.keys(d.results).sort()).toEqual(profileOf(veh("almera"))!.na.slice().sort());
    expect(Object.values(d.results).every((r) => r.s === "na")).toBe(true);
    expect(d).toMatchObject({ type: "weekly", date: TODAY, inspector: "Jack", gstep: 0, activeMs: 0, tick: 1000 });
  });

  it("falls back to a weekly check for an unknown type, and reads a stored copy safely", () => {
    expect(newDraft(veh("h1-2"), "nonsense", TODAY).type).toBe("weekly");
    expect(newDraft(veh("h1-2"), "trip", TODAY).type).toBe("pre");
    expect(loadDraft(null, "x")).toBeNull();
    expect(loadDraft({ vehicleId: "other" }, "x")).toBeNull();
    const d = loadDraft({ type: "monthly", results: { "eng-oil": { s: "bogus", n: "low", p: ["nope", "a".repeat(32)] } }, walk: { front: "b".repeat(32), roof: "c".repeat(32) } }, "x")!;
    expect(d.type).toBe("monthly");
    expect(d.results["eng-oil"]).toEqual({ s: null, n: "low", p: ["a".repeat(32)] });
    expect(d.walk).toEqual({ front: "b".repeat(32) });
  });

  it("uses the newer of the device and server copies", () => {
    const a = { ...newDraft(veh("h1-2"), "weekly", TODAY), savedAt: 5 };
    const b = { ...a, savedAt: 9 };
    expect(newerDraft(a, b)).toBe(b);
    expect(newerDraft(b, a)).toBe(b);
    expect(newerDraft(null, a)).toBe(a);
    expect(newerDraft(a, null)).toBe(a);
  });
});

describe("time tracker (SPEC 6.10)", () => {
  it("counts active time, a gap longer than 10 minutes as 10, like the app", () => {
    const app = appFns(false);
    const mine = { activeMs: 0, tick: 0 };
    app.S.draft = { activeMs: 0, tick: 0 };
    let now = 1_000_000;
    const taps = [0, 45e3, 2 * 60e3, 30 * 60e3, 10e3, TIME_CAP_MS, TIME_CAP_MS + 1, 5e3];
    for (const dt of taps) {
      now += dt;
      tickDraft(mine, now);
      app.setNow(now);
      app.tickDraft();
    }
    expect(mine.activeMs).toBe(app.S.draft.activeMs);
    expect(mine.activeMs).toBe(45e3 + 2 * 60e3 + TIME_CAP_MS + 10e3 + TIME_CAP_MS + TIME_CAP_MS + 5e3);
  });
});

describe("measurements", () => {
  const app = appFns(false);
  const ix = checklistIndex(cl);
  const measured = Object.values(ix).filter((it) => it.m);

  it("grades tread and brake pads like the app", () => {
    expect(measured.length).toBeGreaterThan(0);
    for (const it of measured)
      for (const val of ["", "0", "1.5", "1,6", "2.9", "3", "3.0", "8", "abc", " 4 "])
        expect(autoStatus(it.m as never, val), `${it.id} ${val}`).toBe(app.autoStatus(it, val));
  });

  it("tread: under 1.6 mm is Fix now, under 3 mm Monitor", () => {
    const m = { u: "mm", f: 1.6, w: 3 };
    expect(autoStatus(m, "1.5")).toBe("fix");
    expect(autoStatus(m, "2,5")).toBe("mon");
    expect(autoStatus(m, "3")).toBe("ok");
    expect(autoStatus(m, "")).toBeNull();
    expect(toNum("1 234,5")).toBe(1234.5);
  });
});

describe("step by step", () => {
  it("follows the route exactly as the app, for every vehicle and check", () => {
    for (const hasAttn of [false, true]) {
      const app = appFns(hasAttn);
      for (const v of F.vehicles)
        for (const type of ["pre", "post", "weekly", "monthly", "workshop"])
          expect(guidedSteps(cl, type, v, hasAttn), `${v.id} ${type} ${hasAttn}`).toEqual(
            JSON.parse(JSON.stringify(app.guidedSteps(type, v)))
          );
    }
  });

  it("puts the walk-around photos at the start of the outside, and keep an eye on after Get ready", () => {
    const steps = guidedSteps(cl, "weekly", veh("h1-2"), true);
    expect(steps[0]).toEqual({ k: "ready" });
    expect(steps[1]).toEqual({ k: "attn" });
    const photos = steps.findIndex((s) => s.k === "photos");
    expect(photos).toBeGreaterThan(1);
    expect(steps[photos + 1]).toMatchObject({ k: "item", first: false });
    expect(steps[steps.length - 1]).toEqual({ k: "finish" });
    expect(guidedSteps(cl, "pre", veh("h1-2"), true).some((s) => s.k === "attn" || s.k === "photos")).toBe(false);
    const stages = guidedStages(steps);
    expect(stages[0].n).toBe(2);
    expect(new Set(stages.map((s) => s.st)).size).toBe(stages.length);
  });

  it("leaves out points the model doesn't have", () => {
    const ids = guidedSteps(cl, "monthly", veh("almera"), false).flatMap((s) => (s.k === "item" ? [s.id] : []));
    for (const na of profileOf(veh("almera"))!.na) expect(ids).not.toContain(na);
  });
});

function weeklyDraft(v: FleetVehicle) {
  const d = newDraft(v, "weekly", TODAY, " Jack ", 0);
  const ids = itemsFor(cl, "weekly");
  d.odometer = "225 100";
  d.results[ids[0]] = { s: "ok", p: [] };
  d.results[ids[1]] = { s: "fix", n: "Leaking", p: ["a".repeat(32)] };
  d.results[ids[2]] = { s: "mon", p: [] };
  d.results[ids[3]] = { n: "note only", p: [] };
  d.results["tyr-fl"] = { s: "fix", v: "1.2", p: [] }; // a monthly point: not in a weekly check
  return { d, ids };
}

describe("save (saveInspection)", () => {
  it("refuses what the app refuses, with the app's words", () => {
    const v = veh("h1-2");
    const base = newDraft(v, "weekly", TODAY);
    const b = (patch: object) => buildInspection(cl, { ...base, ...patch }, { vehicleId: v.id, today: TODAY });
    expect(b({ date: "" })).toEqual({ error: "Enter the date of the inspection." });
    expect(b({ odometer: "" })).toEqual({ error: "Enter the odometer reading in km." });
    expect(b({ odometer: "0" })).toEqual({ error: "Enter the odometer reading in km." });
    expect(b({ odometer: "225000" })).toEqual({ error: "Mark at least one point before saving." });
    expect(b({ odometer: "225000", date: "2026-11-18" })).toEqual({ error: "The date can't be in the future." });
  });

  it("keeps only the points in the check, with their wording and section, and counts them", () => {
    const v = veh("h1-2");
    const { d, ids } = weeklyDraft(v);
    const out = buildInspection(cl, d, { vehicleId: v.id, today: TODAY });
    if ("error" in out) throw new Error(out.error);
    const ix = checklistIndex(cl);
    expect(Object.keys(out.doc.results).sort()).toEqual(ids.slice(0, 4).sort());
    expect(out.doc.results[ids[1]]).toEqual({ s: "fix", v: "", n: "Leaking", p: ["a".repeat(32)], t: ix[ids[1]].t, sec: ix[ids[1]].secName });
    expect(out.doc.results[ids[3]].s).toBeNull();
    expect(out.doc).toMatchObject({ type: "weekly", odometer: 225100, inspector: "Jack", provider: "", bookingId: null, docs: [], counts: { ok: 1, mon: 1, fix: 1, na: 0 } });
  });

  it("SPEC 10.10: a weekly check with 17 minutes of active use saves mins 17", () => {
    const v = veh("h1-2");
    const { d } = weeklyDraft(v);
    d.activeMs = 0;
    d.tick = 0;
    let now = 1_000_000;
    tickDraft(d, now);
    for (let i = 0; i < 7; i++) tickDraft(d, (now += 60e3)); // 7 minutes of taps
    tickDraft(d, (now += 25 * 60e3)); // a 25-minute road test counts as 10
    const out = buildInspection(cl, d, { vehicleId: v.id, today: TODAY });
    if ("error" in out) throw new Error(out.error);
    expect(out.doc.mins).toBe(17);
  });

  it("changes the vehicle as the app does", () => {
    const v = { ...veh("h1-2"), status: "On a trip", condition: { "eng-oil": { s: "ok" as const, d: "2026-12-01" } } };
    const { d, ids } = weeklyDraft(v);
    d.type = "post";
    for (const id of itemsFor(cl, "post").slice(0, 2)) d.results[id] = { s: "ok", p: [] };
    d.results["eng-oil"] = { s: "fix", p: [] };
    d.bookingId = "00000000-0000-0000-0000-0000000000bb";
    const out = buildInspection(cl, d, { vehicleId: v.id, today: TODAY });
    if ("error" in out) throw new Error(out.error);
    expect(out.doc.bookingId).toBe(d.bookingId);
    const patch = vehiclePatchAfterSave(v, { date: "2026-12-01" }, out.doc, "ins1");
    const cond = patch.condition as Record<string, { s: string; i: string }>;
    // a later inspection already set eng-oil: kept
    expect(cond["eng-oil"]).toEqual({ s: "ok", d: "2026-12-01" });
    const set = Object.entries(out.doc.results).filter(([id, r]) => r.s && id !== "eng-oil").map(([id]) => id);
    expect(Object.entries(cond).filter(([, c]) => c.i === "ins1").map(([id]) => id).sort()).toEqual(set.sort());
    expect(patch).toMatchObject({ odometer: 225100, odometerDate: TODAY, odoPrev: { km: 224920, date: "2026-03-23" }, lastPost: { id: "ins1", date: TODAY }, status: "In service", statusSince: TODAY });
    expect(patch.lastInspection).toBeUndefined(); // a later one exists
    expect(patch.lastCheck).toBeUndefined(); // post isn't a routine check
    expect(ids.length).toBeGreaterThan(3);
  });

  it("sets lastCheck and lastMonthly for a monthly check, and leaves a lower odometer alone", () => {
    const v = veh("h1-2");
    const d = newDraft(v, "monthly", TODAY);
    d.odometer = "1000";
    d.results["tyr-fl"] = { s: "mon", v: "2.5", p: [] };
    const out = buildInspection(cl, d, { vehicleId: v.id, today: TODAY });
    if ("error" in out) throw new Error(out.error);
    const patch = vehiclePatchAfterSave(v, null, out.doc, "m1");
    expect(patch).toMatchObject({
      lastInspection: { id: "m1", date: TODAY, type: "monthly", counts: { ok: 0, mon: 1, fix: 0, na: 0 } },
      lastCheck: { id: "m1", date: TODAY, type: "monthly" },
      lastMonthly: { id: "m1", date: TODAY },
    });
    expect(patch.odometer).toBeUndefined();
    expect(patch.status).toBeUndefined();
  });

  it("round-trips through a database row", () => {
    const v = veh("h1-2");
    const out = buildInspection(cl, weeklyDraft(v).d, { vehicleId: v.id, today: TODAY });
    if ("error" in out) throw new Error(out.error);
    const row = { id: "r1", created_at: "2026-11-17T08:00:00Z", ...inspectionToRow(out.doc, "u1") };
    expect(row).toMatchObject({ vehicle_id: v.id, odometer_km: 225100, created_by: "u1", mins: 1 });
    expect(inspectionFromRow(row)).toMatchObject({ ...out.doc, id: "r1", createdBy: "u1" });
  });
});

describe("delete (recomputeVehicle)", () => {
  const ins = (id: string, type: Inspection["type"], date: string, results: Inspection["results"], createdAt = "") =>
    ({ id, type, date, results, counts: { ok: 1, mon: 0, fix: 0, na: 0 }, createdAt }) as Inspection;
  const r = (s: "ok" | "fix", n = "") => ({ s, v: "", n, p: [], t: "Oil", sec: "Engine" });

  it("rebuilds condition and the last* fields from the remaining inspections, oldest first", () => {
    const out = recomputeVehicle([
      ins("b", "monthly", "2026-11-10", { "eng-oil": r("fix", "low") }),
      ins("c", "post", "2026-11-12", { "ext-front": r("ok") }),
      ins("a", "weekly", "2026-11-03", { "eng-oil": r("ok"), "eng-cool": r("ok") }),
    ]);
    expect(out.condition).toEqual({
      "eng-oil": { s: "fix", d: "2026-11-10", v: "", n: "low", p: [], i: "b", t: "Oil" },
      "eng-cool": { s: "ok", d: "2026-11-03", v: "", n: "", p: [], i: "a", t: "Oil" },
      "ext-front": { s: "ok", d: "2026-11-12", v: "", n: "", p: [], i: "c", t: "Oil" },
    });
    expect(out.lastInspection).toMatchObject({ id: "c", type: "post" });
    expect(out.lastCheck).toEqual({ id: "b", date: "2026-11-10", type: "monthly" });
    expect(out.lastMonthly).toEqual({ id: "b", date: "2026-11-10" });
  });

  it("clears everything when none are left", () => {
    expect(recomputeVehicle([])).toEqual({ condition: {}, lastInspection: null, lastCheck: null, lastMonthly: null });
  });
});

describe("report text", () => {
  it("is the app's text", () => {
    const doc = {
      vehicleId: "h1-2",
      type: "weekly",
      date: TODAY,
      odometer: 225100,
      fuel: "½",
      inspector: "Jack",
      provider: "",
      bookingId: null,
      docs: [],
      results: {
        "tyr-fl": { s: "fix", v: "1.2", n: "Bald on the edge", p: [], t: "Tread depth: front left", sec: "Tyres" },
        "eng-oil": { s: "mon", v: "", n: "", p: [], t: "Engine oil level", sec: "Engine" },
        "ext-front": { s: "ok", v: "", n: "", p: [], t: "Front", sec: "Body" },
      },
      walk: {},
      extra: [],
      summary: "Book tyres.",
      counts: { ok: 1, mon: 1, fix: 1, na: 2 },
      mins: 17,
      startedAt: "",
    } as Inspection;
    expect(reportText(doc, { name: "Hyundai H1 #2", reg: "CA 123" }, cl, "HULC")).toBe(
      [
        "Weekly check: Hyundai H1 #2 (CA 123)",
        "17 Nov 2026 · 225 100 km · HULC · by Jack",
        "Result: 1 fix now, 1 monitor, 1 OK, 2 N/A",
        "",
        "FIX NOW",
        "- Tread depth: front left: 1.2 mm. Bald on the edge",
        "",
        "MONITOR",
        "- Engine oil level",
        "",
        "SUMMARY",
        "Book tyres.",
      ].join("\n")
    );
  });
});
