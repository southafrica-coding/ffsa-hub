import { describe, expect, it } from "vitest";
import { formatZarFromCents } from "./money";

describe("formatZarFromCents", () => {
  it("formats rand with a space thousands separator and a comma", () => {
    expect(formatZarFromCents(1_245_000)).toBe("R 12 450,00");
    expect(formatZarFromCents(100)).toBe("R 1,00");
    expect(formatZarFromCents(50)).toBe("R 0,50");
    expect(formatZarFromCents(0)).toBe("R 0,00");
  });

  it("puts a minus sign in front of a negative amount", () => {
    expect(formatZarFromCents(-1_250)).toBe("-R 12,50");
    expect(formatZarFromCents(-1_245_000)).toBe("-R 12 450,00");
  });

  it("rounds to the nearest cent", () => {
    expect(formatZarFromCents(199.6)).toBe("R 2,00");
  });
});
