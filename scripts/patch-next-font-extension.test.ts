import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { fontFileExtension, patch } = require("./patch-next-font-extension.cjs") as {
  fontFileExtension: (url: string, formatHint?: string) => string;
  patch: () => { loaderPath: string; findPath: string };
};

const KIT =
  "https://fonts.gstatic.com/l/font?kit=UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA&skey=c491285d6722e4fa&v=v20";

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

describe("installed Next font loader", () => {
  it("parses a kit URL from CSS and no longer dereferences a null match", () => {
    const { loaderPath, findPath } = patch();
    const loader = readFileSync(loaderPath, "utf8");
    expect(loader).not.toContain(".exec(googleFontFileUrl)[1]");
    expect(loader).toContain("preloadFontFile, ext");

    const { findFontFilesInCss } = require(findPath) as {
      findFontFilesInCss: (
        css: string,
        subsets?: string[]
      ) => Array<{ googleFontFileUrl: string; ext: string; preloadFontFile: boolean }>;
    };
    const css = [
      "/* latin */",
      "@font-face {",
      "  font-family: 'Roboto';",
      "  src: url(" + KIT + ") format('woff2');",
      "}",
      "/* latin */",
      "@font-face {",
      "  src: url(https://fonts.gstatic.com/s/roboto/v51/example.woff2) format('woff2');",
      "}",
    ].join("\n");
    const files = findFontFilesInCss(css, ["latin"]);
    expect(files[0]).toMatchObject({ googleFontFileUrl: KIT, ext: "woff2", preloadFontFile: true });
    expect(files[1].ext).toBe("woff2");
  });
});
