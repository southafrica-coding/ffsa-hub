import { describe, expect, it } from "vitest";
import {
  moveReasonsFor,
  moveRow,
  nextTags,
  readCount,
  readMove,
  readNewItem,
  stockAttention,
  uniqueSlug,
} from "./inventory";

const item = {
  tracking: "counted",
  name: "Glasses",
  description: "Clear wine glasses, 250 ml",
  category: "Catering",
  quantity: "60",
};

describe("readNewItem", () => {
  it("reads a counted item", () => {
    const r = readNewItem(item);
    expect("item" in r && r.item).toMatchObject({
      tracking: "counted",
      name: "Glasses",
      category: "catering",
      quantity: 60,
      tagPrefix: null,
      isRequestable: true,
    });
  });

  it("needs a description", () => {
    expect(readNewItem({ ...item, description: "  " })).toEqual({
      error: "Describe it: what it is, size, colour, anything that tells it apart.",
    });
  });

  it("tagged items need a prefix and at least one unit", () => {
    expect("error" in readNewItem({ ...item, tracking: "tagged", quantity: 2 })).toBe(true);
    expect("error" in readNewItem({ ...item, tracking: "tagged", quantity: 0, tagPrefix: "AUD" })).toBe(true);
    const r = readNewItem({ ...item, tracking: "tagged", quantity: 2, tagPrefix: "aud" });
    expect("item" in r && r.item.tagPrefix).toBe("AUD");
  });

  it("consumables are never requestable", () => {
    const r = readNewItem({ ...item, tracking: "consumable", isRequestable: true, reorderAt: "10" });
    expect("item" in r && r.item).toMatchObject({ isRequestable: false, reorderAt: 10 });
  });

  it("reads the price in rand", () => {
    const r = readNewItem({ ...item, unitCost: "45.50" });
    expect("item" in r && r.item.unitCostCents).toBe(4550);
    expect("error" in readNewItem({ ...item, unitCost: "forty" })).toBe(true);
  });
});

describe("stock moves", () => {
  it("offers handing out only for consumables, recount only to the manager", () => {
    expect(moveReasonsFor("consumable", false)).toContain("handed_out");
    expect(moveReasonsFor("counted", false)).not.toContain("handed_out");
    expect(moveReasonsFor("counted", false)).not.toContain("correction");
    expect(moveReasonsFor("counted", true)).toContain("correction");
    expect(moveReasonsFor("tagged", true)).toEqual([]);
  });

  it("signs the change by reason", () => {
    const lost = readMove({ reason: "lost", quantity: 2, note: "Left at the venue" });
    expect("move" in lost && moveRow(lost.move, "counted", 10, false)).toEqual({
      row: { delta: -2, reason: "lost", note: "Left at the venue", supplier: null, unit_cost_cents: null },
    });
    const bought = readMove({ reason: "bought", quantity: 12, supplier: "Mr Price", unitCost: "30" });
    expect("move" in bought && moveRow(bought.move, "counted", 10, false)).toMatchObject({
      row: { delta: 12, supplier: "Mr Price", unit_cost_cents: 3000 },
    });
  });

  it("a recount sets the new total", () => {
    const m = readMove({ reason: "correction", quantity: 58, note: "Counted the shelf" });
    expect("move" in m && moveRow(m.move, "counted", 60, true)).toMatchObject({ row: { delta: -2 } });
    expect("move" in m && moveRow(m.move, "counted", 58, true)).toEqual({ error: "The count is already 58." });
    expect("move" in m && moveRow(m.move, "counted", 60, false)).toEqual({ error: "Only the inventory manager can recount." });
  });

  it("never goes below zero", () => {
    const m = readMove({ reason: "handed_out", quantity: 30 });
    expect("move" in m && moveRow(m.move, "consumable", 26, false)).toEqual({ error: "There are only 26 in stock." });
  });

  it("losses need a note", () => {
    expect(readMove({ reason: "damaged", quantity: 1 })).toEqual({ error: "Say what happened in the note." });
  });
});

describe("readCount", () => {
  const line = { quantity: 20, qty_out: null, qty_back: null };

  it("counts out up to what was booked", () => {
    expect(readCount({ stage: "out", count: 18 }, line)).toEqual({ count: { stage: "out", count: 18, note: null } });
    expect(readCount({ stage: "out", count: 21 }, line)).toEqual({ error: "Only 20 were booked." });
  });

  it("back, damaged and missing add up to what went out", () => {
    const out = { ...line, qty_out: 18 };
    expect(readCount({ stage: "back", count: 16, damaged: 1, missing: 1, note: "One broke, one gone" }, out)).toMatchObject({
      count: { count: 16, damaged: 1, missing: 1 },
    });
    expect("error" in readCount({ stage: "back", count: 17 }, out)).toBe(true);
    expect(readCount({ stage: "back", count: 17, missing: 1 }, out)).toEqual({
      error: "Say what happened to the damaged or missing ones.",
    });
    expect(readCount({ stage: "back", count: 18 }, line)).toEqual({ error: "Count it out first." });
  });
});

describe("helpers", () => {
  it("makes unique slugs", () => {
    expect(uniqueSlug("Wooden “N”", [])).toBe("wooden-n");
    expect(uniqueSlug("Glasses", ["glasses", "glasses-2"])).toBe("glasses-3");
  });

  it("continues the tag numbers", () => {
    expect(nextTags("AUD", ["AUD-0014", "AUD-0002", "AUX-0099"], 2)).toEqual(["AUD-0015", "AUD-0016"]);
    expect(nextTags("DEC", [], 1)).toEqual(["DEC-0001"]);
  });

  it("flags low consumables and missing descriptions", () => {
    expect(stockAttention({ tracking: "consumable", stock: 4, reorderAt: 5, description: "x" })).toBe("Reorder (4 left)");
    expect(stockAttention({ tracking: "counted", stock: 60, reorderAt: null, description: null })).toBe("No description yet");
  });
});
