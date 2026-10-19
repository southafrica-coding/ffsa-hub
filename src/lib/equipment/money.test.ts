import { describe, it, expect } from "vitest";
import { rands } from "./money";

describe("rands", () => {
  it("puts a space between thousands and a point before cents", () => {
    expect(rands(125000)).toBe("R 1 250.00");
    expect(rands(123456789)).toBe("R 1 234 567.89");
  });

  it("handles small amounts", () => {
    expect(rands(0)).toBe("R 0.00");
    expect(rands(5)).toBe("R 0.05");
    expect(rands(99999)).toBe("R 999.99");
  });

  it("uses ordinary spaces, not non-breaking ones", () => {
    expect(rands(100000000)).toBe("R 1 000 000.00");
    expect(rands(100000000)).not.toMatch(/ | /);
  });

  it("signs negatives", () => {
    expect(rands(-25000)).toBe("-R 250.00");
  });
});
