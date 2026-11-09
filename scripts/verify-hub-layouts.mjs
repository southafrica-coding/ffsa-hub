/**
 * Rendered checks for the org chart phone/desktop share and mocked canManage.
 *
 * Browser: real Chrome (viewport is real, not mocked).
 * Authorization on this page: the canManage prop, chosen by ?role=reader|manager.
 *   That is a mock. It does not prove RLS or a signed-in session.
 *   Denied viewers are covered by src/app/(admin)/org-chart/page.auth.test.ts.
 *
 * Usage (from the repo root, with next available and playwright-core installed):
 *   node scripts/verify-hub-layouts.mjs
 *
 * The script copies scripts/fixtures/layout-fixtures-page.tsx into
 * src/app/legal/layout-fixtures/page.tsx, drives it, then deletes that route.
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.error("BLOCKER: playwright-core is not installed. npm install --no-save playwright-core");
  process.exit(2);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixtureSrc = path.join(root, "scripts/fixtures/layout-fixtures-page.tsx");
const fixtureDest = path.join(root, "src/app/legal/layout-fixtures/page.tsx");
const outDir = process.env.LAYOUT_OUT || path.join(root, "scripts/fixtures/last-run");
const base = process.env.LAYOUT_BASE || "http://localhost:3000";
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const pass = (n, d) => results.push({ n, ok: true, d });
const fail = (n, d) => results.push({ n, ok: false, d });

function copyFixture() {
  fs.mkdirSync(path.dirname(fixtureDest), { recursive: true });
  fs.copyFileSync(fixtureSrc, fixtureDest);
}
function deleteFixture() {
  fs.rmSync(fixtureDest, { force: true });
  const dir = path.dirname(fixtureDest);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

async function up(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.status;
  } catch {
    return 0;
  }
}

async function ensureServer() {
  if ((await up(base + "/legal/layout-fixtures")) > 0) return null;
  const log = fs.openSync(path.join(outDir, "next.log"), "a");
  const child = spawn("npm", ["run", "dev", "--", "--port", "3000"], {
    cwd: root,
    stdio: ["ignore", log, log],
    detached: false,
  });
  for (let i = 0; i < 40; i++) {
    if ((await up(base + "/legal/layout-fixtures")) > 0) return child;
    await new Promise((r) => setTimeout(r, 2000));
  }
  child.kill("SIGTERM");
  throw new Error("Next did not answer " + base + "/legal/layout-fixtures");
}

async function overflow(page, sel) {
  return page.$eval(sel, (el) => ({
    sw: el.scrollWidth,
    cw: el.clientWidth,
    pw: document.documentElement.scrollWidth,
    pc: document.documentElement.clientWidth,
  }));
}
function assertFit(label, m) {
  if (m.sw - m.cw > 1 || m.pw - m.pc > 1) fail(label, JSON.stringify(m));
  else pass(label, JSON.stringify(m));
}

const phone = (page) => page.locator("[data-fixture=chart] .xl\\:hidden");
const canvas = (page) => page.locator("[data-fixture=chart] .xl\\:block");

async function ready(page) {
  await page.getByText("mocked canManage").waitFor({ timeout: 90000 });
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === "1");
}

let server = null;
let browser;
try {
  copyFixture();
  server = await ensureServer();
  // The route was just written; give Next one compile.
  let saw = 0;
  for (let i = 0; i < 60; i++) {
    saw = await up(base + "/legal/layout-fixtures");
    if (saw === 200) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (saw !== 200) throw new Error("fixture route status " + saw);

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE", msg.text());
  });

  // Read-only viewer: mocked canManage=false. Real OrgPhone.
  await page.goto(base + "/legal/layout-fixtures?role=reader", { waitUntil: "domcontentloaded" });
  await ready(page);
  await phone(page).getByRole("heading", { name: /Rooted/ }).waitFor();
  if (await phone(page).getByRole("button", { name: "Edit the chart" }).count()) fail("reader has no edit", "button present");
  else pass("reader has no edit", "Edit the chart absent");
  if (await phone(page).getByRole("link", { name: "Who is who" }).count()) fail("reader has no who-is-who", "link present");
  else pass("reader has no who-is-who", "link absent");
  await phone(page).getByRole("button", { name: /Empty Roster/ }).click();
  await phone(page).getByText("Nobody is on this roster yet.").waitFor();
  const readerCopy = await phone(page).locator("p").allTextContents();
  if (readerCopy.some((t) => t.includes("Who is who"))) fail("reader empty copy", JSON.stringify(readerCopy));
  else pass("reader empty copy", "no edit instructions");
  assertFit("reader 375 overflow", await overflow(page, "[data-fixture=chart]"));
  await page.screenshot({ path: path.join(outDir, "reader-empty-375.png") });

  // Manager share: phone edit at 375 publishes the team; canvas at 1280 shows it.
  await page.goto(base + "/legal/layout-fixtures?role=manager", { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await phone(page).getByRole("button", { name: "Edit the chart" }).click();
  await phone(page).getByRole("button", { name: "Done editing" }).waitFor();
  await phone(page).getByRole("button", { name: /Media/ }).click();
  await phone(page).getByText("CHANGES SAVE AS YOU GO").waitFor();
  await phone(page).getByText("Media", { exact: true }).waitFor();
  pass("manager edit opens Media at 375", "panel");
  assertFit("share at 375 before widen", await overflow(page, "[data-fixture=chart]"));
  await page.screenshot({ path: path.join(outDir, "share-phone-edit-375.png") });

  await page.setViewportSize({ width: 1280, height: 900 });
  await canvas(page).getByText("CHANGES SAVE AS YOU GO").waitFor({ timeout: 10000 });
  await canvas(page).getByText("Media", { exact: true }).first().waitFor();
  pass("share phone→canvas keeps Media edit at 1280", "canvas panel");
  assertFit("share at 1280", await overflow(page, "[data-fixture=chart]"));
  await page.screenshot({ path: path.join(outDir, "share-canvas-edit-1280.png") });

  await canvas(page).getByRole("button", { name: "Done editing" }).click();
  await page.setViewportSize({ width: 375, height: 800 });
  await phone(page).getByRole("heading", { name: /Rooted|Media/ }).waitFor();
  if (await phone(page).getByText("CHANGES SAVE AS YOU GO").count()) fail("share canvas done→phone", "edit panel still open");
  else pass("share canvas done→phone closes edit at 375", "panel gone");
  assertFit("share back at 375", await overflow(page, "[data-fixture=chart]"));
  await page.screenshot({ path: path.join(outDir, "share-phone-after-done-375.png") });

  // Reverse: canvas picks Trustees while editing; phone follows.
  await page.goto(base + "/legal/layout-fixtures?role=manager&fresh=canvas", { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await canvas(page).getByRole("button", { name: "Edit the chart" }).click();
  await canvas(page).getByRole("button", { name: "Done editing" }).waitFor();
  await canvas(page).locator("text=Trustees").first().click();
  await canvas(page).getByText("CHANGES SAVE AS YOU GO").waitFor();
  pass("canvas edit opens Trustees", "panel");
  assertFit("canvas trustees 1280", await overflow(page, "[data-fixture=chart]"));
  await page.setViewportSize({ width: 375, height: 800 });
  await phone(page).getByText("CHANGES SAVE AS YOU GO").waitFor({ timeout: 10000 });
  await phone(page).getByText("Trustees", { exact: true }).waitFor();
  pass("share canvas→phone keeps Trustees edit at 375", "phone panel");
  assertFit("share trustees at 375", await overflow(page, "[data-fixture=chart]"));
  await page.screenshot({ path: path.join(outDir, "share-phone-trustees-375.png") });
} finally {
  if (browser) await browser.close();
  deleteFixture();
  if (server) server.kill("SIGTERM");
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exit(1);
