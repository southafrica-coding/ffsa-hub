import tailwindConfig, { themeColors } from "../../../tailwind.config";
import { navigationTheme } from "../navigation";
import { fontAssets } from "../fonts";
import {
  bannerStyle,
  buttonStyle,
  chipStyle,
  maxFontScale,
  needsYouBandStyle,
  refreshControlColors,
  switchColors,
  textStyle,
  textVariants,
  type TextVariant,
} from "../styles";
import { colors, fontFamily, fontSize, MIN_LABEL_SIZE, palette, radius, space, touch } from "../tokens";

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
  it("holds the redesign values (design-spec §2)", () => {
    expect(palette).toMatchObject({
      ink: "#0A0A0A",
      paper: "#F4F2EA",
      subtle: "#FBFAF7",
      rule: "#E7E4D9",
      ruleStrong: "#8E8A7C",
      textSecondary: "#55524A",
      textTertiary: "#6B675D",
      yellow: "#FFB801",
      green: "#3E7F2B",
      amber: "#8A6400",
      destructive: "#D92D20",
      blue: "#000DE5",
      bone: "#C5C2AE",
    });
  });

  it("uses the dark theme base", () => {
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

  it("bone is no longer a light surface", () => {
    expect(colors.light.surface).not.toBe(palette.paper);
    expect(Object.values(colors.light)).not.toContain(palette.paper);
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
  it("keeps the text hierarchy: text > secondary >= tertiary > quiet", () => {
    const [t, s2, t3, q] = [c.text, c.textSecondary, c.textTertiary, c.textQuiet].map((x) => contrast(x, c.bg));
    expect(t).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThanOrEqual(t3);
    expect(t3).toBeGreaterThan(q);
  });
});

describe("native controls that take colours as props", () => {
  it.each(["light", "dark"] as const)("%s: pull-to-refresh spinner is visible on its disc", (scheme) => {
    const c = colors[scheme];
    const r = refreshControlColors(c);
    expect(r).toEqual({ tintColor: c.text, colors: [c.text], progressBackgroundColor: c.surface });
    expect(contrast(r.colors[0], r.progressBackgroundColor)).toBeGreaterThanOrEqual(3);
  });

  it("light switches: ink when on, white thumb", () => {
    for (const value of [true, false]) {
      expect(switchColors(colors.light, "light", value)).toEqual({
        trackColor: { false: colors.light.ruleStrong, true: palette.ink },
        ios_backgroundColor: colors.light.ruleStrong,
        thumbColor: colors.light.bg,
      });
    }
  });

  it("dark switches are yellow when on, and the thumbs stand out from the page and the track", () => {
    expect(switchColors(colors.dark, "dark", true).trackColor.true).toBe(palette.yellow);
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

describe("tertiary text is body-size safe now (redesign)", () => {
  // Was the web's #7C786C (4.41:1, large text only). #6B675D passes AA.
  it.each(["light", "dark"] as const)("%s: tertiary text on bg >= 4.5:1", (scheme) => {
    expect(contrast(colors[scheme].textTertiary, colors[scheme].bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("shape, size and type tokens", () => {
  it("6pt controls, 8pt cards, nothing larger", () => {
    expect(radius).toEqual({ none: 0, control: 6, card: 8 });
  });

  it("keeps touch targets at 48 (44 floor) and every size at 11+", () => {
    expect(touch.minTarget).toBe(48);
    expect(touch.floor).toBe(44);
    expect(MIN_LABEL_SIZE).toBeGreaterThanOrEqual(11);
    for (const size of Object.values(fontSize)) expect(size).toBeGreaterThanOrEqual(11);
    expect(fontSize.body).toBe(16);
  });

  it("uses the spacing scale 4 · 8 · 12 · 16 · 24 · 32 · 48 and a 16–20 gutter", () => {
    expect([space.xs, space.sm, space.md, space.lg, space.xl, space.xxl, space.xxxl]).toEqual([4, 8, 12, 16, 24, 32, 48]);
    expect(space.gutter).toBeGreaterThanOrEqual(16);
    expect(space.gutter).toBeLessThanOrEqual(20);
  });

  it("loads Roboto 400–900, Condensed 400 and Mono 500/700, and no Roboto Condensed 900", () => {
    expect(Object.keys(fontAssets).sort()).toEqual(Object.values(fontFamily).sort());
    expect(Object.keys(fontAssets)).not.toContain("RobotoCondensed_900Black");
    expect(fontFamily.display).toBe("Roboto_900Black");
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
    expect(theme.borderRadius).toEqual({ none: "0px", control: "6px", card: "8px", DEFAULT: "6px" });
  });

  it("maps font families to the loaded font names", () => {
    const families = tailwindConfig.theme!.fontFamily as Record<string, string[]>;
    expect(families.sans).toEqual([fontFamily.body]);
    expect(families.display).toEqual([fontFamily.display]);
    expect(families.mono).toEqual([fontFamily.mono]);
  });
});

describe("component style mapping", () => {
  const variants = Object.keys(textVariants) as TextVariant[];

  it.each(variants)("text variant %s never goes below 11 and uses a loaded font", (v) => {
    const s = textStyle(v, "default", colors.light);
    expect(s.fontSize).toBeGreaterThanOrEqual(11);
    expect(Object.values(fontFamily)).toContain(s.fontFamily);
  });

  it("matches the spec's type scale (design-spec §3)", () => {
    const spec: Partial<Record<TextVariant, [string, number, number]>> = {
      eyebrow: [fontFamily.bodyBold, 12, 16],
      label: [fontFamily.bodySemibold, 13, 18],
      monoLabel: [fontFamily.monoBold, 11, 16],
      caption: [fontFamily.body, 13, 18],
      body: [fontFamily.body, 16, 24],
      sectionTitle: [fontFamily.bodySemibold, 15, 22],
      rowTitle: [fontFamily.bodySemibold, 16, 24],
      pageTitle: [fontFamily.display, 28, 34],
      hero: [fontFamily.display, 34, 36],
      kpi: [fontFamily.bodyMedium, 24, 32],
      note: [fontFamily.condensed, 14, 20],
    };
    for (const [v, [family, size, line]] of Object.entries(spec) as [TextVariant, [string, number, number]][]) {
      expect([v, textVariants[v].fontFamily, textVariants[v].fontSize, textVariants[v].lineHeight]).toEqual([v, family, size, line]);
    }
  });

  it("caps only the title, hero, eyebrow and mono codes; titles are Roboto 900 at -0.01em", () => {
    const capsVariants = variants.filter((v) => textVariants[v].textTransform === "uppercase").sort();
    expect(capsVariants).toEqual(["display", "eyebrow", "hero", "monoLabel", "pageTitle", "title"]);
    expect(textStyle("pageTitle", "default", colors.light)).toMatchObject({
      fontFamily: "Roboto_900Black",
      letterSpacing: -0.28,
    });
    expect(textStyle("kpi", "default", colors.light).fontVariant).toEqual(["tabular-nums"]);
    expect(textStyle("numeral", "default", colors.light).fontVariant).toEqual(["tabular-nums"]);
  });

  it("legacy names still render: display = pageTitle, bodyStrong = Roboto 500", () => {
    expect(textVariants.display).toEqual(textVariants.pageTitle);
    expect(textVariants.bodyStrong.fontFamily).toBe(fontFamily.bodyMedium);
  });

  it("body text follows the OS font size fully; only display sizes are capped", () => {
    for (const v of ["body", "caption", "label", "rowTitle", "sectionTitle", "note", "eyebrow"] as const) {
      expect(maxFontScale[v]).toBeUndefined();
    }
    for (const v of ["pageTitle", "hero", "kpi"] as const) expect(maxFontScale[v]).toBeGreaterThan(1);
  });

  it("maps tones to scheme colours; eyebrow, label and note default to secondary", () => {
    expect(textStyle("body", "default", colors.dark).color).toBe(colors.dark.text);
    expect(textStyle("body", "danger", colors.light).color).toBe(palette.destructive);
    expect(textStyle("body", "onAccent", colors.dark).color).toBe(palette.ink);
    expect(textStyle("label", "default", colors.light).color).toBe(colors.light.textSecondary);
    expect(textStyle("eyebrow", "onAccent", colors.light).color).toBe(palette.ink);
    expect(textStyle("caption", "bone", colors.dark).color).toBe(palette.bone);
  });

  it("buttons are 50pt (44 small), 6pt radius, never a shadow", () => {
    for (const v of ["primary", "secondary", "danger", "dangerFill"] as const) {
      const { container } = buttonStyle(v, colors.light, { pressed: false, disabled: false });
      expect(container.minHeight).toBe(50);
      expect(container.borderRadius).toBe(radius.control);
      expect(container).not.toHaveProperty("shadowOpacity");
      expect(container).not.toHaveProperty("elevation");
      expect(buttonStyle(v, colors.light, { pressed: false, disabled: false }, "small").container.minHeight).toBe(44);
    }
    for (const v of ["text", "ghost"] as const) {
      expect(buttonStyle(v, colors.light, { pressed: false, disabled: false }).container.minHeight).toBe(44);
    }
  });

  it("primary is ink/white in light and yellow/black in dark", () => {
    const light = buttonStyle("primary", colors.light, { pressed: false, disabled: false });
    const dark = buttonStyle("primary", colors.dark, { pressed: false, disabled: false });
    expect([light.container.backgroundColor, light.textColor]).toEqual([palette.ink, palette.white]);
    expect([dark.container.backgroundColor, dark.textColor]).toEqual([palette.yellow, palette.ink]);
  });

  it("text buttons are underlined; legacy destructive = danger; disabled is a readable quiet block", () => {
    expect(buttonStyle("text", colors.light, { pressed: false, disabled: false }).text.textDecorationLine).toBe("underline");
    expect(buttonStyle("destructive", colors.light, { pressed: false, disabled: false })).toEqual(
      buttonStyle("danger", colors.light, { pressed: false, disabled: false }),
    );
    const off = buttonStyle("primary", colors.light, { pressed: false, disabled: true });
    expect(off.container.backgroundColor).toBe(colors.light.surface);
    expect(off.textColor).toBe(colors.light.textTertiary);
  });

  it("the needs-you band is a yellow fill with black text, 8pt radius and no border", () => {
    for (const scheme of ["light", "dark"] as const) {
      const band = needsYouBandStyle(colors[scheme]);
      expect(band).toMatchObject({ backgroundColor: palette.yellow, borderRadius: 8 });
      expect(band).not.toHaveProperty("borderWidth");
      const s = bannerStyle("needsYou", colors[scheme]);
      expect(s.container.borderWidth).toBe(0);
      expect(s.text).toBe("onAccent");
    }
  });

  it("banners have a full 1px border and 8pt radius; errors use the danger border; only the band uses yellow", () => {
    for (const tone of ["info", "offline", "queued", "positive", "error", "danger"] as const) {
      const s = bannerStyle(tone, colors.light);
      expect(s.container).toMatchObject({ borderWidth: 1, borderRadius: 8 });
      expect(JSON.stringify(s.container)).not.toContain(palette.yellow);
    }
    expect(bannerStyle("error", colors.light).container.borderColor).toBe(palette.destructive);
  });

  it("chips are 24pt with a 6pt radius and a currentColor border", () => {
    for (const scheme of ["light", "dark"] as const) {
      const c = colors[scheme];
      for (const v of ["positive", "attention", "danger"] as const) {
        const s = chipStyle(v, c);
        expect(s.container.minHeight).toBe(24);
        expect(s.container.borderRadius).toBe(6);
        expect(s.container.borderColor).toBe(s.color);
      }
      expect(chipStyle("ink", c).container.backgroundColor).toBe(c.inverse);
      expect(chipStyle("dashed", c).container.borderStyle).toBe("dashed");
    }
  });
});
