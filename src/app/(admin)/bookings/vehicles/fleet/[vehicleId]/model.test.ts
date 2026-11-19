import { describe, expect, it } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import {
  attentionRows,
  bookedVisits,
  conditionView,
  draftChecked,
  historyItems,
  inspectionFromRow,
  issuesText,
  keyDates,
  manualStages,
  photoGroups,
  pointTag,
  recentTrips,
  tabOf,
  workshopSpend,
  type Visit,
} from "./model";

const TUE = "2026-11-17";
const vOf = (F: ReturnType<typeof seedFleetData>, id: string) => F.vehicles.find((v) => v.id === id)!;
const visitsOf = (F: ReturnType<typeof seedFleetData>, id: string) => F.visits.filter((r) => r.vehicleId === id) as unknown as Visit[];

describe("tabs", () => {
  it("defaults to overview", () => {
    expect(tabOf(undefined)).toBe("overview");
    expect(tabOf("photos")).toBe("photos");
    expect(tabOf("nonsense")).toBe("overview");
  });
});

describe("Issue list for workshop", () => {
  it("lists Fix now and Monitor points in checklist order, then stale workshop points", () => {
    const F = withVehicle(seedFleetData(TUE), "crv", {
      odometer: 312606,
      condition: {
        "tyr-fl": { s: "fix", v: 1.2, n: "Bald on the inside", d: "2026-11-10" },
        "ext-front": { s: "mon", d: "2026-11-10" },
        "eng-atf": { s: "ok", d: "2026-10-01" },
      },
    });
    const txt = issuesText(F.checklist, vOf(F, "crv"), "VIN123", TUE);
    const lines = txt.split("\n");
    expect(lines[0]).toBe(`Honda CR-V (${vOf(F, "crv").reg})`);
    expect(lines[1]).toContain("312 606 km · VIN VIN123");
    expect(lines[2]).toBe("Issue list as at 17 Nov 2026");
    expect(txt).toMatch(/FIX NOW\n- .*: 1\.2 mm\. Bald on the inside \(noted 10 Nov 2026\)/);
    expect(txt.indexOf("FIX NOW")).toBeLessThan(txt.indexOf("MONITOR"));
    expect(txt).toContain("PLEASE ALSO CHECK (not inspected in the last 6 months)");
    // eng-atf was checked six weeks ago, so it isn't on the "also check" list.
    const atf = F.checklist.sections.flatMap((s) => s.items).find((i) => i.id === "eng-atf")!.t;
    expect(txt.split("PLEASE ALSO CHECK")[1]).not.toContain("- " + atf + "\n");
  });

  it("says so when there are no open issues", () => {
    const F = seedFleetData(TUE);
    expect(issuesText(F.checklist, vOf(F, "almera"), null, TUE)).toContain("\n\nNo open issues from our own checks.");
  });
});

describe("Condition tab", () => {
  const F = withVehicle(seedFleetData(TUE), "crv", {
    condition: { "ext-front": { s: "mon", d: "2026-11-10", i: "i1" }, "ext-rear": { s: "fix", d: "2026-11-10" }, "ext-left": { s: "ok" } },
  });
  const v = vOf(F, "crv");

  it("counts the chips", () => {
    expect(conditionView(F.checklist, v, "all").chips).toEqual([
      ["all", "All", 124],
      ["issues", "Issues", 2],
      ["unchecked", "Not checked yet", 121],
      ["ok", "OK", 1],
    ]);
  });

  it("issues: Fix now before Monitor", () => {
    const rows = conditionView(F.checklist, v, "issues").sections.flatMap((s) => s.rows);
    expect(rows.map((r) => r.id)).toEqual(["ext-rear", "ext-front"]);
  });

  it("empty view message", () => {
    const G = seedFleetData(TUE);
    const view = conditionView(G.checklist, vOf(G, "almera"), "issues");
    expect(view.sections).toEqual([]);
    expect(view.empty).toBe("No open issues on the latest checks.");
  });

  it("pointTag names the check a point belongs to", () => {
    expect(pointTag({ in: ["pre", "weekly"] })).toBe("Weekly");
    expect(pointTag({ in: ["workshop"] })).toBe("Workshop");
    expect(pointTag({ in: ["post"] })).toBe("Post-trip");
    expect(pointTag({})).toBe("Not in any check");
  });
});

describe("Overview", () => {
  it("key dates: an expired disc, the FFSA service rule, and spend over 12 months", () => {
    const F = withVehicle(seedFleetData(TUE), "h1-1", { licenceExpiry: "2026-11-01", serviceKm: null, serviceMonths: null });
    const kd = keyDates(vOf(F, "h1-1"), visitsOf(F, "h1-1"), TUE);
    const get = (k: string) => kd.find((d) => d.k === k)!;
    expect(get("Licence disc expires")).toMatchObject({ v: "01 Nov 2026", expired: true });
    expect(get("Service interval").v).toBe("10 000 km (FFSA rule)");
    expect(get("Workshop spend, last 12 months").v?.replace(/\s/g, " ")).toBe("R 600,00"); // the fake data set's body-repair visit
    expect(workshopSpend(visitsOf(F, "h1-1"), "2027-11-01")).toBe(0);
  });

  it("booked visits soonest first", () => {
    const vs = [
      { id: "b", vehicleId: "x", status: "booked", date: "2026-11-25" },
      { id: "d", vehicleId: "x", status: "done", date: "2026-11-01" },
      { id: "a", vehicleId: "x", status: "booked", date: "2026-11-19" },
    ] as Visit[];
    expect(bookedVisits(vs).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("trips from the last 30 days on, marked now / past / soon", () => {
    const base = seedFleetData(TUE);
    const F = {
      ...base,
      trips: [
        { id: "old", vehicleId: "crv", from: "2026-09-01", to: "2026-09-05" },
        { id: "past", vehicleId: "crv", from: "2026-11-01", to: "2026-11-05" },
        { id: "now", vehicleId: "crv", from: "2026-11-16", to: "2026-11-18" },
        { id: "soon", vehicleId: "crv", from: "2026-12-01", to: "2026-12-03" },
      ],
    };
    expect(recentTrips(F, "crv").map((t) => [t.id, t.when])).toEqual([
      ["past", "past"],
      ["now", "now"],
      ["soon", "soon"],
    ]);
  });

  it("keep an eye on: watch notes, recent repairs and flags, with their grey line", () => {
    const F = withVehicle(seedFleetData(TUE), "h1-1", { condition: { "ext-front": { s: "fix", d: "2026-11-10" } } });
    const rows = attentionRows(F.checklist, vOf(F, "h1-1"), TUE, visitsOf(F, "h1-1"));
    expect(rows.some((r) => r.src === "watch" && r.label)).toBe(true);
    expect(rows.find((r) => r.src === "record")!.line).toContain("from the workshop history");
    const flag = rows.find((r) => r.src === "flag")!;
    expect(flag.label).toBe("Fix now");
    expect(flag.line).toMatch(/^10 Nov 2026 · Check at: .+ · from the last inspection$/);
  });
});

describe("History and Photos", () => {
  const insp = [
    inspectionFromRow({
      id: "i1",
      type: "weekly",
      date: "2026-11-10",
      odometer_km: 312000,
      walk: { front: "f".repeat(32), rear: null },
      results: { "ext-front": { s: "mon", p: ["p".repeat(32)], t: "Front bumper" } },
      extra: ["e".repeat(32)],
      created_at: "2026-11-10T08:00:00Z",
      booking_id: "bk1",
    }, [{ id: "bk1:crv", vehicleId: "crv", from: "2026-11-01", to: "2026-11-05", label: "HULC" }]),
  ];
  const visits = [
    { id: "r1", vehicleId: "crv", status: "done", kind: "Body repair", date: "2026-11-12", files: [{ id: "w".repeat(32), name: "after.jpg", type: "image/jpeg" }, { id: "x".repeat(32), name: "invoice.pdf", type: "application/pdf" }] },
  ] as Visit[];

  it("newest first across inspections, visits and km readings", () => {
    const items = historyItems(insp, visits, [{ id: "o1", km: 312500, date: "2026-11-14", note: "", createdAt: "" }]);
    expect(items.map((x) => x.k + x.id)).toEqual(["oo1", "rr1", "ii1"]);
    expect((items[2] as { trip: string }).trip).toBe("HULC");
  });

  it("photos grouped per inspection (walk-around, issues, extra) and workshop images only", () => {
    const g = photoGroups(insp, visits);
    expect(g.map((x) => x.title)).toEqual(["Body repair", "Weekly check"]);
    expect(g[1].ph.map((p) => p.cap)).toEqual(["Front", "Front bumper", "Extra photo"]);
    expect(g[1].inspectionId).toBe("i1");
    expect(g[0].ph).toEqual([{ id: "w".repeat(32), cap: "after.jpg" }]);
  });
});

describe("Manual", () => {
  it("walk-around order, leaving out points this model doesn't have", () => {
    const F = seedFleetData(TUE);
    const st = manualStages(F.checklist, vOf(F, "almera"), TUE, visitsOf(F, "almera"));
    expect(st[0].id).toBe("ready");
    const ids = st.flatMap((s) => s.points.map((p) => p.id));
    expect(ids).not.toContain("ext-slide");
    expect(ids).toContain("ext-front");
    const p = st.flatMap((s) => s.points).find((x) => x.id === "pst-driver")!;
    expect(p.tags).toEqual(["Post-trip"]);
    expect(p.help.why).toBeTruthy();
  });
});

describe("drafts", () => {
  it("counts checked points, or null without a usable draft", () => {
    expect(draftChecked(JSON.stringify({ results: { a: { s: "ok" }, b: { s: "na" }, c: {} } }))).toBe(2);
    expect(draftChecked(null)).toBeNull();
    expect(draftChecked("{oops")).toBeNull();
  });
});
