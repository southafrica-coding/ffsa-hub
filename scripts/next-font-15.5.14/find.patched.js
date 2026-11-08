"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFontFilesInCss = findFontFilesInCss;
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
function findFontFilesInCss(css, subsetsToPreload) {
    const fontFiles = [];
    let currentSubset = "";
    for (const line of css.split("\n")) {
        const newSubset = /\/\* (.+?) \*\//.exec(line)?.[1];
        if (newSubset) {
            currentSubset = newSubset;
        }
        else {
            const googleFontFileUrl = /src: url\((.+?)\)/.exec(line)?.[1];
            if (googleFontFileUrl &&
                !fontFiles.some((foundFile) => foundFile.googleFontFileUrl === googleFontFileUrl)) {
                const format = /format\(['"](.+?)['"]\)/.exec(line)?.[1];
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
