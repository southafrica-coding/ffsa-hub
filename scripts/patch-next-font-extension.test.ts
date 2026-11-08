import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { fontFileExtension, patch, EXPECTED_NEXT_VERSION } = require("./patch-next-font-extension.cjs") as {
  fontFileExtension: (url: string, formatHint?: string) => string;
  patch: (root?: string) => { changed: boolean };
  EXPECTED_NEXT_VERSION: string;
};

const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), "next-font-15.5.14");
const STOCK_FIND = readFileSync(path.join(FIXTURE, "find.stock.js"), "utf8");
const PATCHED_FIND = readFileSync(path.join(FIXTURE, "find.patched.js"), "utf8");
const STOCK_BLOCK = readFileSync(path.join(FIXTURE, "loader.stock-block.js"), "utf8");
const PATCHED_BLOCK = readFileSync(path.join(FIXTURE, "loader.patched-block.js"), "utf8");

const KIT =
  "https://fonts.gstatic.com/l/font?kit=UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA&skey=c491285d6722e4fa&v=v20";

function install(root: string, version: string, find: string, loader: string) {
  const dir = path.join(root, "node_modules/next/dist/compiled/@next/font/dist/google");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, "node_modules/next/package.json"), JSON.stringify({ version }));
  writeFileSync(path.join(dir, "find-font-files-in-css.js"), find);
  writeFileSync(path.join(dir, "loader.js"), `before\n${loader}\nafter\n`);
}

function readInstalled(root: string) {
  const dir = path.join(root, "node_modules/next/dist/compiled/@next/font/dist/google");
  return {
    find: readFileSync(path.join(dir, "find-font-files-in-css.js"), "utf8"),
    loader: readFileSync(path.join(dir, "loader.js"), "utf8"),
  };
}

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), "ffsa-font-patch-"));
}

describe("Google font URL extension", () => {
  it("keeps a normal woff2 path", () => {
    expect(
      fontFileExtension(
        "https://fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3GUBHMdazTgWw.woff2",
        "woff2"
      )
    ).toBe("woff2");
  });

  it("keeps a ttf path even when a format hint is also present", () => {
    expect(
      fontFileExtension("https://fonts.gstatic.com/s/roboto/v51/example.ttf", "woff2")
    ).toBe("ttf");
  });

  it("does not crash on the extensionless kit URL that fails Next 15.5.14", () => {
    expect(/\.(woff|woff2|eot|ttf|otf)$/.exec(KIT)).toBeNull();
    expect(fontFileExtension(KIT, "woff2")).toBe("woff2");
  });

  it("uses the CSS format hint for an extensionless URL", () => {
    expect(fontFileExtension("https://fonts.gstatic.com/l/font?kit=abc", "truetype")).toBe("ttf");
  });
});

describe("next@15.5.14 font loader patch", () => {
  it("rewrites stock files once and leaves the same bytes on a second run", () => {
    const root = tempRoot();
    try {
      install(root, EXPECTED_NEXT_VERSION, STOCK_FIND, STOCK_BLOCK);
      expect(patch(root).changed).toBe(true);
      const once = readInstalled(root);
      expect(once.find).toBe(PATCHED_FIND);
      expect(once.loader).toContain(PATCHED_BLOCK);
      expect(once.loader).not.toContain(".exec(googleFontFileUrl)[1]");
      expect(patch(root).changed).toBe(false);
      const twice = readInstalled(root);
      expect(twice.find).toBe(once.find);
      expect(twice.loader).toBe(once.loader);

      const { findFontFilesInCss } = require(
        path.join(root, "node_modules/next/dist/compiled/@next/font/dist/google/find-font-files-in-css.js")
      ) as {
        findFontFilesInCss: (css: string, subsets?: string[]) => Array<{ ext: string; googleFontFileUrl: string }>;
      };
      const css = `/* latin */\nsrc: url(${KIT}) format('woff2');\nsrc: url(https://fonts.gstatic.com/s/roboto/v51/example.woff2) format('woff2');`;
      const files = findFontFilesInCss(css, ["latin"]);
      expect(files[0]).toMatchObject({ googleFontFileUrl: KIT, ext: "woff2" });
      expect(files[1].ext).toBe("woff2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a different Next version and does not write", () => {
    const root = tempRoot();
    try {
      install(root, "15.5.29", STOCK_FIND, STOCK_BLOCK);
      const before = readInstalled(root);
      expect(() => patch(root)).toThrow(/expected next@15\.5\.14, found 15\.5\.29/);
      const after = readInstalled(root);
      expect(after.find).toBe(before.find);
      expect(after.loader).toBe(before.loader);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a parser that merely defines fontFileExtension", () => {
    const root = tempRoot();
    try {
      const impostor = `${STOCK_FIND}\nfunction fontFileExtension(){ return "woff2"; }\n`;
      install(root, EXPECTED_NEXT_VERSION, impostor, STOCK_BLOCK);
      const before = readInstalled(root);
      expect(() => patch(root)).toThrow(/find-font-files-in-css\.js is not the next@15\.5\.14 original/);
      const after = readInstalled(root);
      expect(after.find).toBe(before.find);
      expect(after.loader).toBe(before.loader);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unexpected loader and a half-patched pair without writing", () => {
    const root = tempRoot();
    try {
      install(root, EXPECTED_NEXT_VERSION, STOCK_FIND, "not the next loader\n");
      const before = readInstalled(root);
      expect(() => patch(root)).toThrow(/loader\.js is not the next@15\.5\.14 original/);
      expect(readInstalled(root).loader).toBe(before.loader);
      expect(readInstalled(root).find).toBe(before.find);

      install(root, EXPECTED_NEXT_VERSION, PATCHED_FIND, STOCK_BLOCK);
      const partial = readInstalled(root);
      expect(() => patch(root)).toThrow(/partial edit/);
      const after = readInstalled(root);
      expect(after.find).toBe(partial.find);
      expect(after.loader).toBe(partial.loader);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
