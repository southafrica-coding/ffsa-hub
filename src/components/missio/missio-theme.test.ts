import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MISSIO_BRAND, missioSkinVars } from "./access";
import { themeFromUrl } from "./theme";

const here = path.dirname(new URL(import.meta.url).pathname);
const themeCss = readFileSync(path.join(here, "missio-theme.css"), "utf8");

/** Custom properties declared inside the first rule whose selector contains `selector`. */
function declared(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const match of css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+):\s*([^;]+?)\s*!important;/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full, test);
    return test(name) ? [full] : [];
  });
}

describe("MissioSA Brand Guide tokens", () => {
  it("maps the skin onto the Guide's named colours", () => {
    const light = missioSkinVars();
    expect(light["--page"]).toBe(MISSIO_BRAND.paper);
    expect(light["--panel"]).toBe(MISSIO_BRAND.cream);
    expect(light["--ink"]).toBe(MISSIO_BRAND.ink);
    expect(light["--sa"]).toBe(MISSIO_BRAND.sun);
    const dark = missioSkinVars("dark");
    expect(dark["--page"]).toBe(MISSIO_BRAND.ink);
    expect(dark["--ink"]).toBe(MISSIO_BRAND.cream);
    expect(dark["--sa"]).toBe(MISSIO_BRAND.lime);
  });

  it("has no rounded corners and no shadows on either ground", () => {
    for (const theme of ["light", "dark"] as const) {
      const vars = missioSkinVars(theme);
      for (const key of ["--radius-xs", "--radius-sm", "--radius-md", "--radius-lg"]) expect(vars[key]).toBe("0");
      for (const key of ["--shadow-1", "--shadow-2", "--shadow-3"]) expect(vars[key]).toBe("none");
    }
  });

  it("never sets lime SA on the paper ground", () => {
    expect(missioSkinVars("light")["--sa"]).not.toBe(MISSIO_BRAND.lime);
  });

  it("lays the same ink values over Missio surfaces in missio-theme.css, for the device setting and #dark", () => {
    const dark = missioSkinVars("dark");
    expect(declared(themeCss, 'html:not([data-missio-theme="light"]) [data-skin="missio"]')).toEqual(dark);
    expect(declared(themeCss, 'html[data-missio-theme="dark"] [data-skin="missio"]')).toEqual(dark);
    expect(themeCss).toContain("@media (prefers-color-scheme: dark)");
    // Missio's dark is its own ink ground, never the Hub's dark mode.
    expect(themeCss.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/html\.dark|\.theme-dark/);
  });
});

describe("Missio skin leaves nothing of the old look", () => {
  const roots = [here, path.join(here, "../../app/missio"), path.join(here, "../../app/connect/missio")];
  const sources = roots.flatMap((root) => files(root, (name) => /\.(css|tsx?)$/.test(name) && !/\.test\./.test(name)));

  it("uses no Fraunces, Archivo or terracotta", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/Fraunces|Archivo|#B4532E|#F3F0E8|#8E3D1F/i);
    }
  });

  it("rounds nothing but circles and casts no drop shadows", () => {
    for (const file of sources.filter((name) => name.endsWith(".css"))) {
      const text = readFileSync(file, "utf8");
      for (const [, value] of text.matchAll(/border-radius:\s*([^;]+);/g)) {
        expect(value.replace(/\s*!important/, ""), file).toMatch(/^(0|50%|var\(--radius-[a-z]+(, 0)?\))$/);
      }
      for (const [, value] of text.matchAll(/box-shadow:\s*([^;]+);/g)) {
        // FFSA's own switcher menu keeps the Hub's look; Missio's variant resets it to none.
        if (file.endsWith("org-switcher.module.css") && /rgba\(0, 0, 0/.test(value)) continue;
        expect(value.replace(/\s*!important/, ""), file).toMatch(/^(none|inset .+|var\(--shadow-1, none\))$/);
      }
    }
  });
});

describe("themeFromUrl", () => {
  it("reads #dark / #light and ?theme=", () => {
    expect(themeFromUrl("#dark", "")).toBe("dark");
    expect(themeFromUrl("#light", "")).toBe("light");
    expect(themeFromUrl("", "?theme=dark")).toBe("dark");
    expect(themeFromUrl("#step-2", "?x=1")).toBeNull();
  });
});
