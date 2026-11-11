import { describe, expect, it } from "vitest";
import { HIRE } from "./hire-theme";

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}

function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) =>
    0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = ["bg", "surface", "surface2", "hover"] as const;

describe("hire theme contrast", () => {
  it("keeps readable text at 4.5:1 and the edge mark at 3:1", () => {
    for (const name of SURFACES) {
      const background = HIRE[name];
      expect(contrastRatio(HIRE.dim, background), `dim on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(HIRE.muted, background), `muted on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(HIRE.dimEdge, background), `edge on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });
});
