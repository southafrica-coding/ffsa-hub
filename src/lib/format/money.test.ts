import { describe, expect, it } from "vitest";
import { formatZarFromCents } from "./money";

describe("formatZarFromCents", () => {
  it("defaults to whole rands with a space as the thousands separator", () => {
    expect(formatZarFromCents(1_245_000)).toBe("R 12 450");
    expect(formatZarFromCents(100)).toBe("R 1");
  });

  it("shows cents only when showCents is set", () => {
    expect(formatZarFromCents(1_245_050, { showCents: true })).toBe("R 12 450,50");
    expect(formatZarFromCents(-1_250, { showCents: true })).toBe("-R 12,50");
    expect(formatZarFromCents(0, { showCents: true })).toBe("R 0,00");
  });

  it("puts a minus sign in front of a negative amount", () => {
    expect(formatZarFromCents(-1_200)).toBe("-R 12");
    expect(formatZarFromCents(-1_245_000)).toBe("-R 12 450");
  });

  it("formats zero as a whole rand", () => {
    expect(formatZarFromCents(0)).toBe("R 0");
    expect(formatZarFromCents(-40)).toBe("R 0");
  });

  it("groups large amounts", () => {
    expect(formatZarFromCents(1_234_567_890_000)).toBe("R 12 345 678 900");
  });

  it("rounds cents to the nearest rand, half away from zero", () => {
    expect(formatZarFromCents(150)).toBe("R 2");
    expect(formatZarFromCents(149)).toBe("R 1");
    expect(formatZarFromCents(-150)).toBe("-R 2");
    expect(formatZarFromCents(-149)).toBe("-R 1");
  });
});
