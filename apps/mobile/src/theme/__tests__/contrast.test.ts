// Every text / background and UI-part / background pair the app actually
// paints, in BOTH schemes, computed from the tokens (docs/accessibility.md).
// Body text needs 4.5:1; large text, outlines, icons and focus marks 3:1.
// Exempt (WCAG): disabled controls and pure decoration (the title tick,
// hairline rules). Those are listed at the bottom so the exemption is explicit.
//
// Redesign (18 Nov 2026, design-spec §2): the light outline (ruleStrong
// #8E8A7C) and placeholder (textQuiet #6B675D) gaps that were held for Jack
// are closed, so nothing here is a "known gap" any more.

import { contrastRatio, formatRatio } from "@/lib/a11y/contrast";

import { colors, palette, type SemanticColors } from "../tokens";

type Key = keyof SemanticColors;
type Pair = [fg: Key, bg: Key, why: string];

// Body-size text on the backgrounds the app paints behind text.
const BODY_TEXT: Pair[] = [
  ["text", "bg", "default text on a page"],
  ["text", "surface", "default text in list groups, banners and pressed rows"],
  ["text", "surfaceStrong", "default text on pressed fills"],
  ["text", "raised", "text in sheets and text fields"],
  ["text", "segmentOn", "the selected segment's label"],
  ["textSecondary", "bg", "secondary text on a page"],
  ["textSecondary", "surface", "captions inside list groups"],
  ["textSecondary", "surfaceStrong", "secondary text on pressed fills"],
  ["textSecondary", "raised", "captions in sheets; field hints"],
  ["textTertiary", "bg", "tertiary captions"],
  ["textTertiary", "surface", "disabled button labels, quiet captions in groups"],
  ["textQuiet", "bg", "placeholder text in an editable field"],
  ["textQuiet", "raised", "placeholder text in a raised field / sheet"],
  ["danger", "bg", "field errors and danger text"],
  ["danger", "surface", "danger text inside groups"],
  ["danger", "raised", "danger chips, errors inside sheets"],
  ["positiveText", "bg", "positive status text"],
  ["positiveText", "surface", "positive status text in groups"],
  ["positiveText", "raised", "positive chips"],
  ["attention", "bg", "attention status text"],
  ["attention", "surface", "attention status text in groups"],
  ["attention", "raised", "attention chips"],
  ["onAccent", "accent", "black text on the yellow needs-you band"],
  ["onAccent", "accentPressed", "black text on pressed yellow"],
  ["onPrimary", "primary", "primary buttons (ink/white light, yellow/black dark)"],
  ["onPrimary", "primaryPressed", "pressed primary buttons"],
  ["onPositive", "positive", "the green 'Checked in' verdict fill"],
  ["onDanger", "danger", "danger-fill buttons, the red verdict fill"],
  ["onInverse", "inverse", "ink chips, tab badges, section bars"],
];

// UI parts that carry meaning: control outlines, switch tracks, focus rings,
// status borders and icons.
const UI_PARTS: Pair[] = [
  ["ruleStrong", "bg", "text field, chip and radio outlines; switch track (off)"],
  ["ruleStrong", "surface", "outlines drawn on the subtle surface (photo slot, secondary buttons)"],
  ["ruleStrong", "raised", "text field outline on a raised field"],
  ["focus", "raised", "focused text field outline"],
  ["primary", "bg", "switch track (on); primary button edge"],
  ["text", "bg", "chevrons-on-press, checked radio"],
  ["danger", "raised", "error outline on a field / banner border"],
  ["positive", "bg", "positive icons"],
  ["attentionBorder", "bg", "attention outline"],
  ["textSecondary", "bg", "inactive tab icons, eye toggle"],
  ["textTertiary", "surface", "row chevrons and web-link icons"],
];

// Decoration and disabled states: drawn, but not required to meet a ratio.
const EXEMPT: Pair[] = [
  ["rule", "bg", "hairline separators (decoration; text and spacing carry the structure)"],
  ["accent", "bg", "title tick and active-tab tick (decoration; tab state is also bold text + role)"],
  ["accent", "segmentOn", "the selected segment's yellow underline (also bold + border)"],
];

describe.each(["light", "dark"] as const)("%s scheme", (scheme) => {
  const c = colors[scheme];

  it.each(BODY_TEXT)("body text %s on %s >= 4.5:1 (%s)", (fg, bg) => {
    const r = contrastRatio(c[fg], c[bg]);
    if (r < 4.5) throw new Error(`${scheme} ${fg} on ${bg} is ${formatRatio(r)}`);
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

  it("bone is text on black only: it passes on ink and fails on white", () => {
    expect(c.bone).toBe(palette.bone);
    expect(contrastRatio(c.bone, palette.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.bone, palette.white)).toBeLessThan(3);
  });
});

describe("the yellow band's black button", () => {
  it("white label on ink >= 4.5:1, and the ink button stands out on yellow >= 3:1", () => {
    expect(contrastRatio(palette.white, palette.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.ink, palette.yellow)).toBeGreaterThanOrEqual(3);
  });
});

describe("redesign values (design-spec §2)", () => {
  it("light uses the new surface, rules and greys", () => {
    expect(colors.light).toMatchObject({
      surface: "#FBFAF7",
      rule: "#E7E4D9",
      ruleStrong: "#8E8A7C",
      textSecondary: "#55524A",
      textTertiary: "#6B675D",
      textQuiet: "#6B675D",
      danger: "#D92D20",
      positiveText: "#3E7F2B",
      positive: "#3E7F2B",
    });
  });

  it("dark keeps its base and lifts tertiary text", () => {
    expect(colors.dark).toMatchObject({
      bg: "#0A0A0A",
      surface: "#161614",
      rule: "#2A2924",
      ruleStrong: "#6B675D",
      text: "#F4F2EA",
      textSecondary: "#C7C3B5",
      textTertiary: "#C7C3B5",
      textQuiet: "#858175",
      positiveText: "#8BC777",
      attention: "#D9A520",
      danger: "#EB7070",
    });
  });

  it("primary buttons: ink/white in light, yellow/black in dark", () => {
    expect([colors.light.primary, colors.light.onPrimary]).toEqual([palette.ink, palette.white]);
    expect([colors.dark.primary, colors.dark.onPrimary]).toEqual([palette.yellow, palette.ink]);
  });
});
