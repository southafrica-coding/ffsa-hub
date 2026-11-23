import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MISSIO_TOKENS, missioSkinVars } from "./access";

const here = path.dirname(new URL(import.meta.url).pathname);
const app = path.join(here, "../../app");
const tokensCss = readFileSync(path.join(here, "missio-tokens.css"), "utf8");

/** The token block from the build guide (§2, board M1a), verbatim. */
const GUIDE = `
  --frame:#1D2520; --frame-ink:#F3EFE4; --frame-ink-2:#A8B0A6; --terra-on-frame:#D7774F;
  --page:#F3F0E8; --panel:#FBF9F4; --subtle:#EEEADF; --rule:#DDD7C8; --rule-strong:#CFC8B6;
  --ink:#1C1B17; --ink-2:#5B574D; --ink-3:#6E685B; --link:#2F5D50;
  --terra:#B4532E; --terra-soft:#F6E4D9; --terra-ink:#8E3D1F;
  --olive:#4E6B4F; --olive-soft:#E3EADF; --olive-ink:#3F5940;
  --gold:#B98A2E;  --gold-soft:#F4EAD2;  --gold-ink:#7A5A17;
  --ok:#3F6E45; --warn:#94631A; --bad:#A3261B;
  --radius-xs:6px; --radius-sm:10px; --radius-md:14px; --radius-lg:20px;
  --shadow-1:0 1px 2px rgba(28,27,23,.05);
  --shadow-2:0 6px 18px rgba(28,27,23,.10);
  --shadow-3:0 -10px 40px rgba(28,27,23,.20);
`;

function props(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+?)\s*;/g)) out[match[1]] = match[2];
  return out;
}

/** Custom properties declared in the first rule whose selector contains `selector`. */
function declared(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return props(css.slice(open + 1, css.indexOf("}", open)));
}

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full, test);
    return test(name) ? [full] : [];
  });
}

describe("Missio tokens (build guide §2)", () => {
  it("are the guide's names and values, exactly", () => {
    expect({ ...MISSIO_TOKENS }).toEqual(props(GUIDE));
  });

  it("are declared under [data-org=missio] in missio-tokens.css with the same values", () => {
    expect(declared(tokensCss, '[data-org="missio"]')).toEqual(props(GUIDE));
  });

  it("are applied inline on Missio surfaces, with the older names as aliases of them", () => {
    const vars = missioSkinVars();
    for (const [name, value] of Object.entries(MISSIO_TOKENS)) expect(vars[name]).toBe(value);
    expect(vars["--side"]).toBe(MISSIO_TOKENS["--frame"]);
    expect(vars["--accent"]).toBe(MISSIO_TOKENS["--terra"]);
    // Terracotta as text is always the darker ink; gold text is gold-ink.
    expect(vars["--accent-text"]).toBe(MISSIO_TOKENS["--terra-ink"]);
    expect(vars["--gold-text"]).toBe(MISSIO_TOKENS["--gold-ink"]);
    expect(vars["--quiet"]).toBe(MISSIO_TOKENS["--ink-3"]);
  });
});

describe("Missio sources", () => {
  const roots = [
    here,
    path.join(app, "missio"),
    path.join(app, "missio-feedback"),
    path.join(app, "connect/missio"),
    path.join(app, "(public)/serve/missio"),
  ];
  const sources = roots.flatMap((root) => files(root, (name) => /\.(css|tsx?)$/.test(name) && !/\.test\./.test(name)));
  const css = sources.filter((name) => name.endsWith(".css"));

  it("carry nothing of the Brand Guide skin (Cormorant, DM Sans, ink green, lime, sun)", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/Cormorant|DM_Sans|DM Sans|#17372F|#D9F45A|#F18F3B|#FFFAF0|#F2EFE6|#0D2923/i);
    }
  });

  it("have no dark page theme", () => {
    for (const file of css) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/prefers-color-scheme:\s*dark|data-missio-theme|data-theme="dark"/);
    }
  });

  it("never set terracotta or gold as a text colour", () => {
    for (const file of css) {
      const text = readFileSync(file, "utf8");
      for (const [, value] of text.matchAll(/(?:^|[;{\s])color:\s*([^;]+);/g)) {
        expect(value, file).not.toMatch(/var\(--(accent|terra|gold)[,)]|#b4532e|#b98a2e/i);
      }
    }
  });

  it("round corners only on the guide's radii", () => {
    const allowed = /^(0|50%|999px|99px|var\(--radius-(xs|sm|md|lg)(, ?\d+px)?\)|[2-9]px|1[0-4]px|20px)$/;
    for (const file of css) {
      const text = readFileSync(file, "utf8");
      for (const [, value] of text.matchAll(/border-radius:\s*([^;]+);/g)) {
        for (const part of value.replace(/\s*!important/, "").split(/\s+(?![^(]*\))/)) expect(part, file).toMatch(allowed);
      }
    }
  });
});
