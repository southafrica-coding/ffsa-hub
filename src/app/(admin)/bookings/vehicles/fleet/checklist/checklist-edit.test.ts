import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultChecklist } from "@/lib/fleet/content";
import { itemsFor, type Checklist } from "@/lib/fleet/rules";
import {
  SUGGEST_MONTHLY,
  addItem,
  addSection,
  allWeekly,
  applySuggestions,
  cleanChecklist,
  normChecklist,
  removeItem,
  removeSection,
  routineOf,
  setItemText,
  setItemType,
  setRoutine,
  setRoutineById,
  setSectionName,
  sortCounts,
  visibleItems,
} from "./checklist-edit";
import { helpFor, suggestedInContent } from "./help";

const STD = defaultChecklist();
const small = (): Checklist => ({
  sections: [
    {
      id: "a",
      name: "Outside",
      items: [
        { id: "ext-front", t: "Front", h: "", in: ["weekly"] },
        { id: "p2", t: "Lights", h: "hint", in: ["pre", "weekly"] },
        { id: "p3", t: "Spare", in: ["monthly"] },
        { id: "p4", t: "Brakes", in: ["workshop"] },
      ],
    },
    { id: "b", name: "Inside", items: [{ id: "cab-seats", t: "Seats", in: ["post", "monthly"] }] },
  ],
});

describe("SUGGEST_MONTHLY", () => {
  it("is the reference app's list", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../../../../../../../vehicles-module/app/ffsa-fleet.html"), "utf8");
    const line = html.match(/const SUGGEST_MONTHLY = new Set\(\[(.*?)\]\)/)![1];
    const ref = [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...SUGGEST_MONTHLY].sort()).toEqual(ref.sort());
  });
  it("matches the suggestMonthly flags in checklist.json", () => {
    expect(suggestedInContent().sort()).toEqual([...SUGGEST_MONTHLY].sort());
  });
});

describe("normChecklist", () => {
  it("copies, and gives old level-based points their checks", () => {
    const cl = { sections: [{ id: "s", name: "S", items: [{ id: "a", t: "A", l: 1 }, { id: "b", t: "B", l: 3 }, { id: "c", t: "C" }] }] } as unknown as Checklist;
    const n = normChecklist(cl);
    expect(n.sections[0].items.map((i) => i.in)).toEqual([["pre", "weekly"], ["workshop"], ["weekly"]]);
    expect(cl.sections[0].items[0].in).toBeUndefined();
  });
});

describe("weekly or monthly", () => {
  it("setRoutine swaps weekly/monthly and keeps the other checks in order", () => {
    expect(setRoutine({ id: "x", t: "x", in: ["pre", "weekly", "workshop"] }, "monthly").in).toEqual(["pre", "monthly", "workshop"]);
    expect(setRoutine({ id: "x", t: "x", in: ["post", "monthly"] }, "weekly").in).toEqual(["post", "weekly"]);
    expect(routineOf({ id: "x", t: "x", in: ["monthly"] })).toBe("monthly");
    expect(routineOf({ id: "x", t: "x", in: ["weekly"] })).toBe("weekly");
  });

  it("counts weekly points and the extra monthly ones", () => {
    expect(sortCounts(small())).toEqual({ w: 2, m: 2 });
  });

  it("setRoutineById changes one point and leaves the original alone", () => {
    const cl = small();
    const n = setRoutineById(cl, "p2", "monthly");
    expect(n.sections[0].items[1].in).toEqual(["pre", "monthly"]);
    expect(cl.sections[0].items[1].in).toEqual(["pre", "weekly"]);
    expect(sortCounts(n)).toEqual({ w: 1, m: 3 });
  });

  it("Use all suggestions: suggested points monthly, the rest weekly, workshop-only untouched", () => {
    const n = applySuggestions(small());
    const by = Object.fromEntries(n.sections.flatMap((s) => s.items).map((i) => [i.id, i.in]));
    expect(by).toEqual({ "ext-front": ["monthly"], p2: ["pre", "weekly"], p3: ["weekly"], p4: ["workshop"], "cab-seats": ["post", "monthly"] });
  });

  it("Use all suggestions on FFSA's checklist leaves the monthly check the same size", () => {
    const n = applySuggestions(STD);
    expect(itemsFor(n, "monthly").length).toBe(itemsFor(STD, "monthly").length);
    const c = sortCounts(n);
    expect(c.m).toBe([...SUGGEST_MONTHLY].filter((id) => itemsFor(STD, "monthly").includes(id)).length);
  });

  it("Make all weekly", () => {
    expect(sortCounts(allWeekly(small()))).toEqual({ w: 4, m: 0 });
  });
});

describe("edit checklist", () => {
  it("renames sections and changes wording and hints", () => {
    let cl = setSectionName(small(), 1, "Cabin");
    cl = setItemText(cl, 0, 1, "t", "Headlights");
    cl = setItemText(cl, 0, 1, "h", "Both beams");
    expect(cl.sections[1].name).toBe("Cabin");
    expect(cl.sections[0].items[1]).toMatchObject({ t: "Headlights", h: "Both beams" });
  });

  it("ticks checks in the checks' order", () => {
    let cl = setItemType(small(), 0, 0, "pre", true);
    expect(cl.sections[0].items[0].in).toEqual(["pre", "weekly"]);
    cl = setItemType(cl, 0, 0, "weekly", false);
    expect(cl.sections[0].items[0].in).toEqual(["pre"]);
  });

  it("adds and removes points and sections", () => {
    let cl = addItem(small(), 0, "new1");
    expect(cl.sections[0].items.at(-1)).toEqual({ id: "new1", t: "", in: ["weekly"], h: "" });
    cl = removeItem(cl, 0, 0);
    expect(cl.sections[0].items.map((i) => i.id)).toEqual(["p2", "p3", "p4", "new1"]);
    cl = addSection(cl, "s9", "x9");
    expect(cl.sections.at(-1)).toEqual({ id: "s9", name: "New section", items: [{ id: "x9", t: "", in: ["weekly"], h: "" }] });
    cl = removeSection(cl, 1);
    expect(cl.sections.map((s) => s.id)).toEqual(["a", "s9"]);
  });

  it("new ids are unique", () => {
    const a = addSection(addItem(addItem(small(), 0), 0));
    const ids = a.sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cleanChecklist (saving)", () => {
  it("trims, names untitled sections, and drops empty points and sections", () => {
    let cl = small();
    cl = setItemText(cl, 0, 0, "t", "  Front  ");
    cl = setItemText(cl, 0, 1, "h", "  hint ");
    cl = addItem(cl, 0, "blank");
    cl = setSectionName(cl, 1, "   ");
    cl = addSection(cl, "empty", "e1");
    const r = cleanChecklist(cl);
    if ("error" in r) throw new Error(r.error);
    expect(r.checklist.sections.map((s) => s.name)).toEqual(["Outside", "Untitled section"]);
    expect(r.checklist.sections[0].items.map((i) => i.id)).toEqual(["ext-front", "p2", "p3", "p4"]);
    expect(r.checklist.sections[0].items[0].t).toBe("Front");
    expect(r.checklist.sections[0].items[1].h).toBe("hint");
    expect(r.checklist.sections[0].items[2].h).toBe("");
  });

  it("keeps a measured point's measure", () => {
    const measured = STD.sections.flatMap((s) => s.items).find((i) => i.m);
    expect(measured).toBeTruthy();
    const r = cleanChecklist(STD);
    if ("error" in r) throw new Error(r.error);
    expect(r.checklist.sections.flatMap((s) => s.items).find((i) => i.id === measured!.id)?.m).toEqual(measured!.m);
  });

  it("refuses a checklist with no points", () => {
    expect(cleanChecklist({ sections: [{ id: "a", name: "A", items: [{ id: "x", t: "  " }] }] })).toEqual({ error: "The checklist needs at least one point." });
  });

  it("FFSA's checklist passes the settings route's checks (ids unique, wording present)", () => {
    const r = cleanChecklist(STD);
    if ("error" in r) throw new Error(r.error);
    const ids = r.checklist.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids.length).toBe(124);
    expect(new Set(ids).size).toBe(124);
  });
});

describe("filter and help", () => {
  it("filters points by check; monthly includes weekly", () => {
    const s = small().sections[0];
    expect(visibleItems(s, "").length).toBe(4);
    expect(visibleItems(s, "pre").map((i) => i.id)).toEqual(["p2"]);
    expect(visibleItems(s, "monthly").map((i) => i.id)).toEqual(["ext-front", "p2", "p3"]);
  });

  it("has help for every standard point and none for points added by hand", () => {
    const ids = STD.sections.flatMap((s) => s.items.map((i) => i.id));
    const h = helpFor([...ids, "x123"]);
    expect(Object.keys(h).length).toBe(124);
    expect(h["x123"]).toBeUndefined();
    expect(h[ids[0]].why).toBeTruthy();
  });
});
