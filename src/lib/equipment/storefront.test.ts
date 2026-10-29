import { describe, it, expect } from "vitest";
import { sortForStore, itemTitle } from "./storefront";

describe("storefront order", () => {
  it("puts free first, then partly free, then booked", () => {
    const sorted = sortForStore([
      { name: "Booked", free: 0, stock: 2 },
      { name: "Partly", free: 2, stock: 4 },
      { name: "Free B", free: 3, stock: 3 },
      { name: "Free A", free: 1, stock: 1 },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Free A", "Free B", "Partly", "Booked"]);
  });

  it("titles a product by its make", () => {
    expect(itemTitle({ name: "Vocal microphone", brand: "Shure", model: "SM58" })).toBe("Shure SM58 vocal microphone");
    expect(itemTitle({ name: "IEM belt pack", brand: null, model: null })).toBe("IEM belt pack");
  });
});
