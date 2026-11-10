import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FFSA_HUB_CSS, FFSA_TITLE_WEIGHT } from "./ffsa";

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = linear(channel(hex, 0));
  const green = linear(channel(hex, 1));
  const blue = linear(channel(hex, 2));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio. 4.5 is AA for normal text. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

describe("hub colour tokens", () => {
  it("mirrors FFSA_HUB_CSS in globals.css :root", () => {
    for (const [name, value] of Object.entries(FFSA_HUB_CSS)) {
      expect(root, name).toContain(`${name}:`);
      expect(root, `${name} ${value}`).toContain(value);
    }
  });

  it("keeps page-title weight in one token", () => {
    expect(FFSA_TITLE_WEIGHT).toBe(900);
    expect(root).toContain(`--title-weight: ${FFSA_TITLE_WEIGHT}`);
  });

  it("meets AA for text, link, and status colours", () => {
    const white = FFSA_HUB_CSS["--bg"];
    const black = FFSA_HUB_CSS["--brand-black"];
    const yellow = FFSA_HUB_CSS["--accent"];
    expect(contrastRatio(FFSA_HUB_CSS["--text"], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FFSA_HUB_CSS["--text-secondary"], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FFSA_HUB_CSS["--text-tertiary"], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FFSA_HUB_CSS["--link"], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(white, black)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(black, yellow)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FFSA_HUB_CSS["--success-text"], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FFSA_HUB_CSS["--warning"], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FFSA_HUB_CSS["--danger"], white)).toBeGreaterThanOrEqual(4.5);
  });

  it("exposes rgb channels so opacity utilities compile", () => {
    const config = readFileSync(new URL("../../../tailwind.config.ts", import.meta.url), "utf8");
    for (const token of ["brand-black", "ink", "primary", "yellow"]) {
      expect(config).toContain("rgb(var(--");
    }
    expect(config).toContain("rgb(var(--brand-black-rgb) / <alpha-value>)");
    expect(config).toContain("rgb(var(--accent-rgb) / <alpha-value>)");
    expect(root).toContain("--brand-black-rgb: 0 0 0");
    expect(root).toContain("--link-rgb: 0 13 229");
    expect(root).toContain("--accent-rgb: 255 184 1");
  });
});
