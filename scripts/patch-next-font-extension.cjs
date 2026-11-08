/**
 * Next 15.5.14 crashes in next/font/google when Google Fonts returns an
 * extensionless /l/font?kit= URL (vercel/next.js#99114). loader.js takes
 * the file extension with regex.exec(url)[1], which throws when the match
 * is null. The file itself still downloaded.
 *
 * postinstall rewrites only that installed loader, and only for next@15.5.14
 * whose CSS parser and loader block match the copies in
 * scripts/next-font-15.5.14/. A second run sees those exact patched bytes
 * and does not write. Anything else fails before a write.
 *
 * Extension rule, same as Next 16.4.3: pathname suffix, otherwise the CSS
 * format() hint, otherwise woff2. A URL that already ends in .woff2/.ttf
 * keeps that suffix.
 */
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_NEXT_VERSION = "15.5.14";
const FIXTURE_DIR = path.join(__dirname, "next-font-15.5.14");

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

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

function googleFontDir(root) {
  return path.join(root, "node_modules/next/dist/compiled/@next/font/dist/google");
}

function assertNextVersion(root) {
  const pkgPath = path.join(root, "node_modules/next/package.json");
  let version = "missing";
  try {
    version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  } catch (err) {
    throw new Error(
      `Refusing to patch next/font: cannot read ${pkgPath} (${err.message})`
    );
  }
  if (version !== EXPECTED_NEXT_VERSION) {
    throw new Error(
      `Refusing to patch next/font: expected next@${EXPECTED_NEXT_VERSION}, found ${version}`
    );
  }
}

function classify(text, stock, patched, label) {
  if (text === stock) return "stock";
  if (text === patched) return "patched";
  throw new Error(
    `Refusing to patch next/font: ${label} is not the next@${EXPECTED_NEXT_VERSION} original or the expected patched file`
  );
}

function classifyLoader(text, stockBlock, patchedBlock) {
  const stockHits = text.split(stockBlock).length - 1;
  const patchedHits = text.split(patchedBlock).length - 1;
  if (stockHits === 1 && patchedHits === 0) return "stock";
  if (stockHits === 0 && patchedHits === 1) return "patched";
  throw new Error(
    `Refusing to patch next/font: loader.js is not the next@${EXPECTED_NEXT_VERSION} original or the expected patched block (stock blocks ${stockHits}, patched blocks ${patchedHits})`
  );
}

function atomicReplace(files) {
  const backups = [];
  const temps = [];
  try {
    for (const file of files) {
      const tmp = `${file.path}.ffsa-tmp`;
      fs.writeFileSync(tmp, file.content);
      temps.push(tmp);
    }
    for (const file of files) {
      const tmp = `${file.path}.ffsa-tmp`;
      const bak = `${file.path}.ffsa-bak`;
      fs.renameSync(file.path, bak);
      backups.push({ path: file.path, bak });
      fs.renameSync(tmp, file.path);
    }
    for (const backup of backups) fs.unlinkSync(backup.bak);
    backups.length = 0;
  } catch (err) {
    for (const backup of backups) {
      if (fs.existsSync(backup.bak)) {
        if (fs.existsSync(backup.path)) fs.rmSync(backup.path);
        fs.renameSync(backup.bak, backup.path);
      }
    }
    throw err;
  } finally {
    for (const tmp of temps) {
      if (fs.existsSync(tmp)) fs.rmSync(tmp);
    }
  }
}

function patch(root = path.join(__dirname, "..")) {
  assertNextVersion(root);
  const stockFind = readFixture("find.stock.js");
  const patchedFind = readFixture("find.patched.js");
  const stockBlock = readFixture("loader.stock-block.js");
  const patchedBlock = readFixture("loader.patched-block.js");
  if (stockFind === patchedFind || stockBlock === patchedBlock) {
    throw new Error("Refusing to patch next/font: stock and patched fixtures are identical");
  }
  // The original parser is the line-based src: url() walker from next@15.5.14.
  if (!stockFind.includes("const googleFontFileUrl = (_b = /src: url\\((.+?)\\)/.exec(line))")) {
    throw new Error("Refusing to patch next/font: stock CSS parser fixture lost its url() matcher");
  }
  if (!stockBlock.includes(".exec(googleFontFileUrl)[1]")) {
    throw new Error("Refusing to patch next/font: stock loader fixture lost the crashing extension read");
  }
  if (!patchedFind.includes("ext: fontFileExtension(googleFontFileUrl, format)") || patchedBlock.includes(".exec(googleFontFileUrl)[1]")) {
    throw new Error("Refusing to patch next/font: patched fixtures are not the expected shape");
  }

  const dir = googleFontDir(root);
  const findPath = path.join(dir, "find-font-files-in-css.js");
  const loaderPath = path.join(dir, "loader.js");
  let findText;
  let loaderText;
  try {
    findText = fs.readFileSync(findPath, "utf8");
    loaderText = fs.readFileSync(loaderPath, "utf8");
  } catch (err) {
    throw new Error(`Refusing to patch next/font: cannot read loader files (${err.message})`);
  }

  const findState = classify(findText, stockFind, patchedFind, "find-font-files-in-css.js");
  const loaderState = classifyLoader(loaderText, stockBlock, patchedBlock);
  if (findState !== loaderState) {
    throw new Error(
      `Refusing to patch next/font: partial edit (parser is ${findState}, loader is ${loaderState})`
    );
  }
  if (findState === "patched") {
    return { changed: false, findPath, loaderPath };
  }

  const nextLoader = loaderText.replace(stockBlock, patchedBlock);
  if (nextLoader === loaderText || classifyLoader(nextLoader, stockBlock, patchedBlock) !== "patched") {
    throw new Error("Refusing to patch next/font: loader replacement did not produce the expected text");
  }
  if (classify(patchedFind, stockFind, patchedFind, "find-font-files-in-css.js") !== "patched") {
    throw new Error("Refusing to patch next/font: patched parser fixture is not recognized");
  }

  atomicReplace([
    { path: findPath, content: patchedFind },
    { path: loaderPath, content: nextLoader },
  ]);
  const writtenFind = fs.readFileSync(findPath, "utf8");
  const writtenLoader = fs.readFileSync(loaderPath, "utf8");
  if (writtenFind !== patchedFind || classifyLoader(writtenLoader, stockBlock, patchedBlock) !== "patched") {
    throw new Error("next/font patch wrote unexpected bytes");
  }
  return { changed: true, findPath, loaderPath };
}

module.exports = {
  EXPECTED_NEXT_VERSION,
  fontFileExtension,
  patch,
};

if (require.main === module) {
  patch();
}
