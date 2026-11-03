import tailwindConfig, { themeColors } from "../../../tailwind.config";
import { navigationTheme } from "../navigation";
import {
  bannerStyle,
  buttonStyle,
  maxFontScale,
  refreshControlColors,
  switchColors,
  textStyle,
  type TextVariant,
} from "../styles";
import { colors, fontFamily, fontSize, MIN_LABEL_SIZE, palette, radius, touch } from "../tokens";

// WCAG 2.x relative luminance / contrast ratio.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("palette", () => {
  it("matches the web's brand values", () => {
    expect(palette).toMatchObject({
      ink: "#0A0A0A",
      bone: "#F4F2EA",
      bone2: "#F1EFE7",
      bone3: "#E7E4D9",
      rule: "#DEDACE",
      ruleStrong: "#C7C3B5",
      yellow: "#FFB801",
      yellowDim: "#FFF4D9",
      green: "#3E7F2B",
      greenText: "#2F6620",
      amber: "#8A6400",
      amberBorder: "#B98600",
      destructive: "#B02929",
      blue: "#000DE5",
    });
  });

  it("uses the proposed dark theme base", () => {
    expect(colors.dark).toMatchObject({
      bg: "#0A0A0A",
      surface: "#161614",
      rule: "#2A2924",
      text: "#F4F2EA",
      accent: "#FFB801",
    });
  });

  it("keeps the accent yellow with black text in both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(colors[scheme].accent).toBe(palette.yellow);
      expect(colors[scheme].onAccent).toBe(palette.ink);
    }
  });
});

describe("contrast (WCAG AA, 4.5:1 for body text)", () => {
  for (const scheme of ["light", "dark"] as const) {
    const c = colors[scheme];
    it.each([
      ["text on bg", c.text, c.bg],
      ["text on surface", c.text, c.surface],
      ["secondary text on bg", c.textSecondary, c.bg],
      ["danger on bg", c.danger, c.bg],
      ["positive text on bg", c.positiveText, c.bg],
      ["attention on bg", c.attention, c.bg],
      ["black on the yellow band", c.onAccent, c.accent],
      ["onInverse on inverse (primary button)", c.onInverse, c.inverse],
    ])(`${scheme}: %s`, (_label, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("dark scheme: every semantic text colour on every background it sits on", () => {
  const c = colors.dark;
  // Body-size text tones x the backgrounds the app paints (page, bone panels,
  // pressed/skeleton fills). textTertiary is checked for large text below.
  const texts = ["text", "textSecondary", "textQuiet", "danger", "positive", "positiveText", "attention"] as const;
  const backgrounds = ["bg", "surface"] as const;
  for (const fg of texts) {
    for (const bg of backgrounds) {
      it(`${fg} on ${bg} >= 4.5:1`, () => {
        expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it.each(["text", "textSecondary", "textTertiary", "danger", "positiveText", "attention"] as const)(
    "%s on surfaceStrong >= 4.5:1",
    (fg) => {
      expect(contrast(c[fg], c.surfaceStrong)).toBeGreaterThanOrEqual(4.5);
    },
  );
  it("text on the inverse bar (section headers, badges) >= 4.5:1", () => {
    expect(contrast(c.onInverse, c.inverse)).toBeGreaterThanOrEqual(4.5);
  });
  it("the yellow band carries black text, and black on yellow >= 4.5:1", () => {
    expect(c.onAccent).toBe(palette.ink);
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    // Light text on yellow would fail: never use it.
    expect(contrast(c.text, c.accent)).toBeLessThan(4.5);
  });
  it("input / switch outlines (ruleStrong) are >= 3:1 on bg and surface (WCAG 1.4.11)", () => {
    expect(contrast(c.ruleStrong, c.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.ruleStrong, c.surface)).toBeGreaterThanOrEqual(3);
  });
  it("keeps the text hierarchy: text > secondary > tertiary > quiet", () => {
    const order = [c.text, c.textSecondary, c.textTertiary, c.textQuiet].map((x) => contrast(x, c.bg));
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });
});

describe("native controls that take colours as props", () => {
  it.each(["light", "dark"] as const)("%s: pull-to-refresh spinner is visible on its disc", (scheme) => {
    const c = colors[scheme];
    const r = refreshControlColors(c);
    expect(r).toEqual({ tintColor: c.text, colors: [c.text], progressBackgroundColor: c.surface });
    expect(contrast(r.colors[0], r.progressBackgroundColor)).toBeGreaterThanOrEqual(3);
  });

  it("light switches keep the white thumb (unchanged look)", () => {
    for (const value of [true, false]) {
      expect(switchColors(colors.light, "light", value)).toEqual({
        trackColor: { false: colors.light.ruleStrong, true: colors.light.text },
        ios_backgroundColor: colors.light.ruleStrong,
        thumbColor: colors.light.bg,
      });
    }
  });

  it("dark switch thumbs stand out from the page and the track", () => {
    const c = colors.dark;
    const off = switchColors(c, "dark", false);
    const on = switchColors(c, "dark", true);
    expect(contrast(off.thumbColor, c.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(off.thumbColor, off.trackColor.false)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(on.thumbColor, on.trackColor.true)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("navigation theme", () => {
  it.each(["light", "dark"] as const)("%s: scenes, cards and headers use the token background", (scheme) => {
    const t = navigationTheme({ scheme, colors: colors[scheme] });
    expect(t.dark).toBe(scheme === "dark");
    expect(t.colors).toMatchObject({
      background: colors[scheme].bg,
      card: colors[scheme].bg,
      text: colors[scheme].text,
      border: colors[scheme].rule,
    });
    expect(t.fonts).toBeDefined();
  });
});

describe("contrast for large text / UI (3:1)", () => {
  // The web's tertiary grey is 4.41:1 on white: fine for large text and
  // decoration, not for body copy. Kept as the web has it; flagged for design.
  it.each(["light", "dark"] as const)("%s: tertiary text on bg", (scheme) => {
    expect(contrast(colors[scheme].textTertiary, colors[scheme].bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("shape, size and type tokens", () => {
  it("has one default radius, small, and nothing large", () => {
    expect(radius.default).toBe(radius.sm);
    expect(radius.sm).toBe(2);
    expect(radius.md).toBe(4);
  });

  it("keeps touch targets at 48 and labels at 11+", () => {
    expect(touch.minTarget).toBe(48);
    expect(MIN_LABEL_SIZE).toBeGreaterThanOrEqual(11);
    for (const size of Object.values(fontSize)) expect(size).toBeGreaterThanOrEqual(11);
    expect(fontSize.body).toBe(16);
  });
});

describe("tailwind theme mirrors the tokens", () => {
  it("maps every semantic colour in light and -dark", () => {
    expect(themeColors.bg).toBe(colors.light.bg);
    expect(themeColors["bg-dark"]).toBe(colors.dark.bg);
    expect(themeColors["text-secondary"]).toBe(colors.light.textSecondary);
    expect(themeColors["text-secondary-dark"]).toBe(colors.dark.textSecondary);
    expect(themeColors["on-accent"]).toBe(colors.light.onAccent);
    expect(themeColors.accent).toBe(palette.yellow);
    expect(Object.keys(themeColors)).toEqual(
      expect.arrayContaining(Object.keys(colors.light).flatMap((k) => [k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)])),
    );
  });

  it("replaces Tailwind's default palette and radii (no off-brand classes)", () => {
    const theme = tailwindConfig.theme!;
    expect(theme.colors).toBe(themeColors);
    expect(themeColors).not.toHaveProperty("blue");
    expect(theme.borderRadius).toEqual({ none: "0px", sm: "2px", md: "4px", DEFAULT: "2px" });
  });

  it("maps font families to the loaded font names", () => {
    const families = tailwindConfig.theme!.fontFamily as Record<string, string[]>;
    expect(families.sans).toEqual([fontFamily.body]);
    expect(families.display).toEqual([fontFamily.display]);
    expect(families.mono).toEqual([fontFamily.mono]);
  });
});

describe("component style mapping", () => {
  const variants: TextVariant[] = ["display", "title", "numeral", "body", "bodyStrong", "caption", "label"];

  it.each(variants)("text variant %s never goes below 11 and uses a tokened font", (v) => {
    const s = textStyle(v, "default", colors.light);
    expect(s.fontSize).toBeGreaterThanOrEqual(11);
    expect(Object.values(fontFamily)).toContain(s.fontFamily);
  });

  it("display and labels are uppercase; display is condensed 900; numerals are tabular", () => {
    expect(textStyle("display", "default", colors.light)).toMatchObject({
      fontFamily: fontFamily.display,
      textTransform: "uppercase",
    });
    expect(textStyle("label", "default", colors.light)).toMatchObject({
      fontFamily: fontFamily.monoBold,
      textTransform: "uppercase",
      fontSize: 11,
    });
    expect(textStyle("numeral", "default", colors.light).fontVariant).toEqual(["tabular-nums"]);
  });

  it("body text follows the OS font size fully", () => {
    expect(maxFontScale.body).toBeUndefined();
  });

  it("maps tones to scheme colours", () => {
    expect(textStyle("body", "default", colors.dark).color).toBe(colors.dark.text);
    expect(textStyle("body", "danger", colors.light).color).toBe(palette.destructive);
    expect(textStyle("body", "onAccent", colors.dark).color).toBe(palette.ink);
  });

  it("buttons are 48dp, use the default radius and never a shadow", () => {
    for (const v of ["primary", "secondary", "ghost", "destructive"] as const) {
      const { container } = buttonStyle(v, colors.light, { pressed: false, disabled: false });
      expect(container.minHeight).toBe(48);
      expect(container.borderRadius).toBe(radius.default);
      expect(container).not.toHaveProperty("shadowOpacity");
      expect(container).not.toHaveProperty("elevation");
    }
    expect(buttonStyle("primary", colors.light, { pressed: false, disabled: false }).container.backgroundColor).toBe(
      palette.ink,
    );
    expect(buttonStyle("primary", colors.light, { pressed: false, disabled: true }).container.opacity).toBeLessThan(1);
  });

  it("the needs-you band is yellow with black text and a black border", () => {
    for (const scheme of ["light", "dark"] as const) {
      const s = bannerStyle("needsYou", colors[scheme]);
      expect(s.container.backgroundColor).toBe(palette.yellow);
      expect(s.container.borderColor).toBe(palette.ink);
      expect(s.text).toBe("onAccent");
    }
  });

  it("only the needs-you band uses yellow", () => {
    for (const tone of ["info", "positive", "danger"] as const) {
      const s = bannerStyle(tone, colors.light);
      expect(JSON.stringify(s.container)).not.toContain(palette.yellow);
    }
  });
});
