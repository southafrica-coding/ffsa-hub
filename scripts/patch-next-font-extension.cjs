/**
 * Next 15.5.14 crashes in next/font/google when Google Fonts returns an
 * extensionless /l/font?kit= URL (vercel/next.js#99114). The file still
 * downloads, then loader.js:122 does regex.exec(url)[1] and throws
 * "Cannot read properties of null (reading '1')".
 *
 * This applies the webpack half of the upstream fix (next 16.4.3 /
 * PR 100158): keep the pathname extension when it exists, otherwise use
 * the CSS format() hint, otherwise woff2 (what Next's Chrome user agent
 * requests). Installed copy only. No font list changes.
 */
const fs = require("node:fs");
const path = require("node:path");

const FORMAT_TO_EXTENSION = {
  woff: "woff",
  woff2: "woff2",
  truetype: "ttf",
  opentype: "otf",
  "embedded-opentype": "eot",
};

function fontFileExtension(googleFontFileUrl, formatHint) {
  const pathname = String(googleFontFileUrl).split(/[?#]/, 1)[0];
  const fromPath = /\.(woff|woff2|eot|ttf|otf)$/.exec(pathname);
  if (fromPath) return fromPath[1];
  if (formatHint && Object.prototype.hasOwnProperty.call(FORMAT_TO_EXTENSION, formatHint)) {
    return FORMAT_TO_EXTENSION[formatHint];
  }
  return "woff2";
}

function googleFontDir(root) {
  return path.join(
    root,
    "node_modules/next/dist/compiled/@next/font/dist/google"
  );
}

const FIND_FILE = `const FORMAT_TO_EXTENSION = {
    woff: "woff",
    woff2: "woff2",
    truetype: "ttf",
    opentype: "otf",
    "embedded-opentype": "eot",
};
function fontFileExtension(googleFontFileUrl, formatHint) {
    const pathname = String(googleFontFileUrl).split(/[?#]/, 1)[0];
    const fromPath = /\\.(woff|woff2|eot|ttf|otf)$/.exec(pathname);
    if (fromPath) return fromPath[1];
    if (formatHint && Object.prototype.hasOwnProperty.call(FORMAT_TO_EXTENSION, formatHint)) {
        return FORMAT_TO_EXTENSION[formatHint];
    }
    return "woff2";
}
function findFontFilesInCss(css, subsetsToPreload) {
    const fontFiles = [];
    let currentSubset = "";
    for (const line of css.split("\\n")) {
        const newSubset = /\\/\\* (.+?) \\*\\//.exec(line)?.[1];
        if (newSubset) {
            currentSubset = newSubset;
        }
        else {
            const googleFontFileUrl = /src: url\\((.+?)\\)/.exec(line)?.[1];
            if (googleFontFileUrl &&
                !fontFiles.some((foundFile) => foundFile.googleFontFileUrl === googleFontFileUrl)) {
                const format = /format\\(['"](.+?)['"]\\)/.exec(line)?.[1];
                fontFiles.push({
                    googleFontFileUrl,
                    preloadFontFile: !!(subsetsToPreload === null || subsetsToPreload === void 0 ? void 0 : subsetsToPreload.includes(currentSubset)),
                    ext: fontFileExtension(googleFontFileUrl, format),
                });
            }
        }
    }
    return fontFiles;
}
`;

function patch(root = path.join(__dirname, "..")) {
  const dir = googleFontDir(root);
  const findPath = path.join(dir, "find-font-files-in-css.js");
  const loaderPath = path.join(dir, "loader.js");
  if (!fs.existsSync(loaderPath) || !fs.existsSync(findPath)) {
    throw new Error(`Next font loader not found at ${dir}`);
  }

  const loader = fs.readFileSync(loaderPath, "utf8");
  const crash = ".exec(googleFontFileUrl)[1]";
  const patchedCall = "async ({ googleFontFileUrl, preloadFontFile, ext })";
  if (loader.includes(crash)) {
    if (!loader.includes("async ({ googleFontFileUrl, preloadFontFile })")) {
      throw new Error("Next font loader shape changed; refusing to patch");
    }
    const crashLine = "const ext = /\\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1];";
    if (!loader.includes(crashLine)) {
      throw new Error("Font loader crash line not found");
    }
    const next = loader
      .replace(
        "async ({ googleFontFileUrl, preloadFontFile })",
        patchedCall
      )
      .replace(crashLine, "/* ext comes from findFontFilesInCss */");
    if (next.includes(crash) || !next.includes(patchedCall)) {
      throw new Error("Font loader patch did not apply cleanly");
    }
    fs.writeFileSync(loaderPath, next);
  } else if (!loader.includes(patchedCall)) {
    throw new Error("Next font loader is neither stock nor already patched");
  }

  const find = fs.readFileSync(findPath, "utf8");
  if (!find.includes("function fontFileExtension(")) {
    const header = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFontFilesInCss = findFontFilesInCss;
`;
    fs.writeFileSync(findPath, header + FIND_FILE);
  }

  return { loaderPath, findPath };
}

module.exports = { fontFileExtension, patch };

if (require.main === module) {
  patch();
}
