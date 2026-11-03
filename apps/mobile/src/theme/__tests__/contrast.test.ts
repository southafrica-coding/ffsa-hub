// Every text / background and UI-part / background pair the app actually
// paints, in BOTH schemes, computed from the tokens (docs/accessibility.md).
// Body text needs 4.5:1; large text, outlines, icons and focus marks 3:1.
// Exempt (WCAG): disabled controls and pure decoration (the masthead tick,
// hairline rules). Those are listed at the bottom so the exemption is explicit.

import { contrastRatio, formatRatio } from "@/lib/a11y/contrast";

import { colors, palette, type SemanticColors } from "../tokens";

type Key = keyof SemanticColors;
type Pair = [fg: Key, bg: Key, why: string];

// Body-size text (Text tones) on the backgrounds the app paints behind text.
// (accentDim is defined but not painted anywhere in the app today.)
const BODY_TEXT: Pair[] = [
  ["text", "bg", "default text on a page"],
  ["text", "surface", "default text on bone panels, sheets and pressed rows"],
  ["text", "surfaceStrong", "default text on pressed buttons and selected chips"],
  ["textSecondary", "bg", "secondary text on a page"],
  ["textSecondary", "surface", "secondary text on bone"],
  ["textSecondary", "surfaceStrong", "secondary text on pressed fills"],
  ["textQuiet", "bg", "placeholder text in an editable field"],
  ["danger", "bg", "field errors and danger text"],
  ["danger", "surface", "danger text inside sheets"],
  ["positiveText", "bg", "positive status text"],
  ["positiveText", "surface", "positive status text on bone"],
  ["attention", "bg", "attention status text"],
  ["attention", "surface", "attention status text on bone"],
  ["onAccent", "accent", "black text on the yellow needs-you band"],
  ["onInverse", "inverse", "primary buttons, section bars, badges"],
];

// Large text (display / title / numerals) only.
const LARGE_TEXT: Pair[] = [["textTertiary", "bg", "tertiary grey is for large text and disabled rows only"]];

// UI parts that carry meaning: control outlines, radio rings, switch tracks,
// status rules and icons, the selected-tab tick on the page.
const UI_PARTS: Pair[] = [
  ["ruleStrong", "bg", "text field, chip and radio outlines; switch track (off)"],
  ["ruleStrong", "surface", "outlines drawn on bone (non-editable fields)"],
  ["text", "bg", "focused field outline, checked radio, switch track (on)"],
  ["danger", "bg", "error outline / danger rule on banners"],
  ["positive", "bg", "positive rule on banners, positive icons"],
  ["attentionBorder", "bg", "attention outline"],
  ["textSecondary", "bg", "inactive tab icons, chevrons, eye toggle"],
  ["onAccent", "accent", "ink border round the yellow band"],
];

// Decoration and disabled states: drawn, but not required to meet a ratio.
const EXEMPT: Pair[] = [
  ["rule", "bg", "hairline separators (decoration; text and spacing carry the structure)"],
  ["accent", "bg", "masthead tick and active-tab tick (decoration; tab state is also bold text + role)"],
  ["textTertiary", "bg", "disabled list rows (WCAG exempts inactive controls)"],
];

describe.each(["light", "dark"] as const)("%s scheme", (scheme) => {
  const c = colors[scheme];

  it.each(BODY_TEXT)("body text %s on %s >= 4.5:1 (%s)", (fg, bg) => {
    const r = contrastRatio(c[fg], c[bg]);
    if (r < 4.5) throw new Error(`${scheme} ${fg} on ${bg} is ${formatRatio(r)}`);
  });

  it.each(LARGE_TEXT)("large text %s on %s >= 3:1 (%s)", (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(3);
  });

  it.each(UI_PARTS)("UI part %s on %s >= 3:1 (%s)", (fg, bg) => {
    const r = contrastRatio(c[fg], c[bg]);
    if (r < 3) throw new Error(`${scheme} ${fg} on ${bg} is ${formatRatio(r)}`);
  });

  it.each(EXEMPT)("exempt %s on %s is still visible (> 1.2:1) (%s)", (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThan(1.2);
  });

  it("yellow only ever carries black text", () => {
    expect(c.onAccent).toBe(palette.ink);
    expect(contrastRatio(palette.white, c.accent)).toBeLessThan(4.5);
  });
});

describe("light-scheme token fixes (proof for docs/accessibility.md)", () => {
  it("the web's outline grey fails 3:1 on white, the app value passes", () => {
    expect(contrastRatio(palette.ruleStrong, palette.white)).toBeLessThan(3);
    expect(contrastRatio(colors.light.ruleStrong, palette.white)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.light.ruleStrong, palette.bone)).toBeGreaterThanOrEqual(3);
  });

  it("the web's quiet grey fails 4.5:1 as placeholder text, the app value passes", () => {
    expect(contrastRatio(palette.textQuiet, palette.white)).toBeLessThan(4.5);
    expect(contrastRatio(colors.light.textQuiet, palette.white)).toBeGreaterThanOrEqual(4.5);
  });

  it("the palette itself (shared with the web) is unchanged", () => {
    expect(palette.ruleStrong).toBe("#C7C3B5");
    expect(palette.textQuiet).toBe("#9A9689");
  });
});
