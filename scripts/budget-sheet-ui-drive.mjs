/**
 * Browser drive for the budget sheet against a local Next server.
 * The server must already be the disposable harness (FFSA_HARNESS=1).
 * Cookie subject is not a GoTrue session.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "/tmp/puppeteer-check/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const base = process.argv[2] || "http://127.0.0.1:3010";
const FINANCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const PERIOD = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const PSQL = process.env.PSQL_BIN || "/usr/lib/postgresql/16/bin/psql";
const SOCKET = process.env.FFSA_VERIFY_SOCKET || "/tmp/ffsa-workbook-verify/socket";
const DB = "ffsa_workbook_verify";
const NAME = `Persist ${Date.now().toString(36)}`;
const shots = "/opt/cursor/artifacts";
mkdirSync(shots, { recursive: true });

const log = [];
function note(message) {
  log.push(message);
  console.log(message);
}

function psql(sql) {
  const result = spawnSync(PSQL, ["-h", SOCKET, "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || "").trim();
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function setValue(page, selector, value) {
  const ok = await page.evaluate(
    (sel, next) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc.set.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    selector,
    value
  );
  if (!ok) throw new Error(`missing input ${selector}`);
}

async function choose(page, aria, text) {
  const picked = await page.evaluate(
    (label, needle) => {
      const el = document.querySelector(`[aria-label="${label}"]`);
      if (!el) return "";
      const opt = [...el.options].find((row) => row.value === needle || row.textContent.includes(needle));
      if (!opt) return "";
      const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      desc.set.call(el, opt.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return opt.value;
    },
    aria,
    text
  );
  if (!picked) throw new Error(`could not choose ${text} in ${aria}`);
  return picked;
}

async function clickExact(page, label) {
  const ok = await page.evaluate((text) => {
    const el = [...document.querySelectorAll("button, a")].find((node) => node.textContent.trim() === text);
    if (!el) return false;
    el.click();
    return true;
  }, label);
  if (!ok) throw new Error(`no control named ${label}`);
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function waitIdle(page) {
  await page.waitForFunction(
    () => ![...document.querySelectorAll("button")].some((button) => button.textContent.includes("Saving"))
  );
}

async function shot(page, name, width) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  note(`screenshot ${shots}/${name}.png at ${width}`);
}

async function budgetId(page) {
  const id = await page.evaluate(() => {
    const match = location.pathname.match(/\/finance\/budgets\/([0-9a-f-]{36})/i);
    return match ? match[1] : "";
  });
  if (!id) throw new Error("page is not a saved budget");
  return id;
}

async function readBudget(page, id) {
  return page.evaluate(async (budgetId) => {
    const res = await fetch(`/api/finance/budgets/${budgetId}`, { cache: "no-store" });
    const body = await res.json();
    return { status: res.status, budget: body.budget ?? null, error: body.error ?? body.message ?? null };
  }, id);
}

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  psql(`
    INSERT INTO public.fiscal_periods (id, org_id, label, kind, start_date, end_date, is_current)
    SELECT '${PERIOD}', id, '2026', 'year', DATE '2026-01-01', DATE '2026-12-31', true
    FROM public.finance_orgs WHERE key = 'npc'
    ON CONFLICT (id) DO NOTHING;
  `);
  note("inserted NPC period 2026");

  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  await page.setCookie({ name: "ffsa-harness-sub", value: FINANCE, domain: "127.0.0.1", path: "/" });
  await page.goto(`${base}/finance/budgets`, { waitUntil: "networkidle0" });
  const opened = await bodyText(page);
  writeFileSync("/tmp/ffsa-ui-budget-open.txt", opened);
  assert(/budget/i.test(opened), `finance page did not render the sheet:\n${opened.slice(0, 800)}`);
  assert(!opened.includes("Complete your profile"), "profile gate hid the sheet");
  assert(opened.includes("FFSA NPC"), "FFSA NPC was not on the sheet");
  assert(opened.includes("2026"), "NPC period 2026 was not offered");
  note("empty sheet shows FFSA NPC and the 2026 period");

  await setValue(page, 'input[placeholder="Name this budget"]', NAME);
  await choose(page, "What this budget belongs to", "staff_ministry");
  await page.waitForFunction(() => document.body.innerText.includes("Worship"));
  await choose(page, "Owner", "Worship");
  await choose(page, "Period", "2026");
  await clickExact(page, "Variable cost");
  await clickExact(page, "Add a line");
  await setValue(page, '[aria-label="Name for this line"]', "Food");
  await setValue(page, '[aria-label="Amount for Food"]', "190.00");
  await setValue(page, '[aria-label="Times for Food"]', "12");
  await setValue(page, '[aria-label="Multiplier for Food"]', "8");
  await clickExact(page, "Create");
  await page.waitForFunction(() => /\/finance\/budgets\/[0-9a-f-]{36}/i.test(location.pathname), { timeout: 60000 });
  const id = await budgetId(page);
  await page.waitForFunction(
    (name) =>
      document.querySelector('input[placeholder="Name this budget"]')?.value === name &&
      !document.body.innerText.includes("Opening this budget"),
    {},
    NAME
  );
  note(`created ${id}`);

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(
    (name) => document.querySelector('input[placeholder="Name this budget"]')?.value === name,
    {},
    NAME
  );
  await clickExact(page, "Variable cost");
  const persisted = await page.evaluate(() => ({
    name: document.querySelector('input[placeholder="Name this budget"]')?.value,
    amount: document.querySelector('[aria-label="Amount for Food"]')?.value,
    times: document.querySelector('[aria-label="Times for Food"]')?.value,
    multiplier: document.querySelector('[aria-label="Multiplier for Food"]')?.value,
  }));
  assert(persisted.name === NAME, `name after refresh ${persisted.name}`);
  assert(persisted.amount === "190.00", `amount after refresh ${persisted.amount}`);
  assert(persisted.times === "12", `frequency after refresh ${persisted.times}`);
  assert(persisted.multiplier === "8", `multiplier after refresh ${persisted.multiplier}`);
  note("refresh kept Food 190 x 12 x 8");

  const before = await readBudget(page, id);
  await clickExact(page, "Save");
  await waitIdle(page);
  const after = await readBudget(page, id);
  assert(after.budget.updatedAt === before.budget.updatedAt, `no-op changed revision ${before.budget.updatedAt} -> ${after.budget.updatedAt}`);
  const revisionRows = psql(`SELECT count(*) FROM public.budget_workbook_revisions WHERE budget_id = '${id}';`);
  assert(revisionRows === "1", `revision rows ${revisionRows}`);
  note("second save with the same sheet did not move the revision");

  await shot(page, "budget-persist-320", 320);
  await shot(page, "budget-persist-375", 375);
  await shot(page, "budget-persist-desktop", 1280);

  await setValue(page, '[aria-label="Amount for Food"]', "250.00");
  const localBeforeConflict = await page.$eval('[aria-label="Amount for Food"]', (el) => el.value);
  const concurrent = await fetch(`${base}/api/finance/budgets/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `ffsa-harness-sub=${FINANCE}`,
    },
    body: JSON.stringify({ notes: "Saved from the other session.", updatedAt: after.budget.updatedAt }),
  });
  const concurrentBody = await concurrent.json();
  assert(concurrent.status === 200, `concurrent save ${concurrent.status} ${JSON.stringify(concurrentBody).slice(0, 400)}`);
  note("other session saved notes");

  await clickExact(page, "Save");
  await page.waitForFunction(() => document.body.innerText.includes("Nothing you typed was overwritten"));
  const keptTyped = await page.$eval('[aria-label="Amount for Food"]', (el) => el.value);
  assert(keptTyped === "250.00", `stale save overwrote the amount to ${keptTyped}`);
  assert(localBeforeConflict === "250.00", "local edit was not 250 before the conflict");
  await shot(page, "budget-stale-desktop", 1280);
  await shot(page, "budget-stale-375", 375);
  await clickExact(page, "Keep what I typed");
  const afterKeep = await page.$eval('[aria-label="Amount for Food"]', (el) => el.value);
  assert(afterKeep === "250.00", `Keep what I typed left ${afterKeep}`);
  const bannerGone = await page.evaluate(() => !document.body.innerText.includes("Nothing you typed was overwritten"));
  assert(bannerGone, "conflict bar stayed after Keep what I typed");
  note("stale save kept the typed 250");

  await clickExact(page, "Save");
  await page.waitForFunction(() => document.body.innerText.includes("Nothing you typed was overwritten"));
  await clickExact(page, "Reload saved copy");
  await waitIdle(page);
  await clickExact(page, "Variable cost");
  const reloadedAmount = await page.$eval('[aria-label="Amount for Food"]', (el) => el.value);
  assert(reloadedAmount === "190.00", `reload left amount ${reloadedAmount}`);
  await clickExact(page, "Notes");
  const reloadedNotes = await page.$eval('[aria-label="Notes"]', (el) => el.value);
  assert(reloadedNotes.includes("Saved from the other session."), `reload notes were ${reloadedNotes}`);
  note("reload replaced the typed amount with the saved 190 and the other session's note");

  await clickExact(page, "Expense tracker");
  await clickExact(page, "Add an expense");
  await setValue(page, '[aria-label="Expense date"]', "2026-03-02");
  await setValue(page, '[aria-label="What the expense was for"]', "Tea for the team");
  await setValue(page, '[aria-label="Expense amount"]', "40.00");
  await clickExact(page, "Save");
  await waitIdle(page);
  const withExpense = await readBudget(page, id);
  assert(
    withExpense.budget.expenses.some((row) => row.description === "Tea for the team" && row.amountCents === 4000),
    `expense was not stored ${JSON.stringify(withExpense.budget?.expenses)}`
  );
  await page.reload({ waitUntil: "networkidle0" });
  await clickExact(page, "Expense tracker");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="What the expense was for"]')?.value === "Tea for the team"
  );
  const expenseAmount = await page.$eval('[aria-label="Expense amount"]', (el) => el.value);
  assert(expenseAmount === "40.00", `expense amount ${expenseAmount}`);
  note("expense row survived refresh");
  await shot(page, "budget-expense-375", 375);

  const submitted = psql(`UPDATE public.budgets SET status = 'submitted' WHERE id = '${id}' RETURNING status;`);
  assert(submitted === "submitted", `status update returned ${submitted}`);
  await page.reload({ waitUntil: "networkidle0" });
  const submittedText = await bodyText(page);
  assert(submittedText.includes("This budget is submitted. Only finance can change it."), "submitted note missing");
  note("submitted tracker note is on the sheet");
  await shot(page, "budget-submitted-desktop", 1280);
  await shot(page, "budget-submitted-320", 320);

  const approved = psql(`UPDATE public.budgets SET status = 'approved' WHERE id = '${id}' RETURNING status;`);
  assert(approved === "approved", `approve update returned ${approved}`);
  await clickExact(page, "Notes");
  await setValue(page, '[aria-label="Notes"]', "Still typed after approval");
  await clickExact(page, "Save");
  await page.waitForFunction(
    () =>
      /approved budget|can't be changed|doesn't submit or approve/i.test(document.body.innerText) &&
      !document.body.innerText.includes("Saving")
  );
  const forbiddenText = await bodyText(page);
  const typedNote = await page.$eval('[aria-label="Notes"]', (el) => el.value);
  assert(typedNote === "Still typed after approval", `forbidden save left ${typedNote}`);
  note(`server refused the save: ${forbiddenText.split("\n").find((line) => /approved|submit or approve|can't/i.test(line)) || forbiddenText.slice(0, 240)}`);
  const stillApproved = psql(`SELECT notes FROM public.budgets WHERE id = '${id}';`);
  assert(stillApproved.includes("Saved from the other session."), `approved row notes changed: ${stillApproved}`);
  assert(!stillApproved.includes("Still typed after approval"), "approved row stored the rejected note");
  note("save after approval kept the typed note and did not write it");

  await page.reload({ waitUntil: "networkidle0" });
  const lockedText = await bodyText(page);
  assert(lockedText.includes("This budget is approved. It can't be changed until it is reopened."), "approved lock copy missing");
  const disabled = await page.$eval("fieldset", (el) => el.disabled);
  assert(disabled, "approved sheet fieldset is still editable");
  await shot(page, "budget-approved-desktop", 1280);
  await shot(page, "budget-approved-320", 320);
  note("approved sheet is locked");

  const leaderPage = await browser.newPage();
  await leaderPage.setCookie({ name: "ffsa-harness-sub", value: LEADER, domain: "127.0.0.1", path: "/" });
  await leaderPage.goto(`${base}/finance/budgets/${id}`, { waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const leaderUrl = leaderPage.url();
  let leaderText = "";
  try {
    leaderText = await bodyText(leaderPage);
  } catch {
    leaderText = "(page navigated before the text could be read)";
  }
  writeFileSync("/tmp/ffsa-ui-budget-leader.txt", `${leaderUrl}\n${leaderText.slice(0, 1500)}`);
  assert(new URL(leaderUrl).pathname === "/finance", `leader stayed on ${leaderUrl}`);
  note(`leader landed on ${leaderUrl}`);
  const currentRes = await fetch(`${base}/api/finance/budgets/${id}`, {
    headers: { Cookie: `ffsa-harness-sub=${FINANCE}` },
  });
  const current = await currentRes.json();
  const leaderWrite = await fetch(`${base}/api/finance/budgets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `ffsa-harness-sub=${LEADER}` },
    body: JSON.stringify({ notes: "leader should not write", updatedAt: current.budget.updatedAt }),
  });
  const leaderBody = await leaderWrite.json();
  assert(
    leaderWrite.status === 403 || leaderWrite.status === 404,
    `leader write status ${leaderWrite.status} ${JSON.stringify(leaderBody).slice(0, 300)}`
  );
  const unchanged = psql(`SELECT notes FROM public.budgets WHERE id = '${id}';`);
  assert(unchanged.includes("Saved from the other session."), `leader write changed notes: ${unchanged}`);
  assert(!unchanged.includes("leader should not write"), "leader note was stored");
  note(`leader write rejected ${leaderWrite.status} and the sheet was not changed`);

  writeFileSync(
    "/tmp/ffsa-workbook-verify/ui-drive-result.txt",
    ["UI_DRIVE_OK", ...log].join("\n") + "\n"
  );
  note("UI_DRIVE_OK");
} catch (error) {
  writeFileSync("/tmp/ffsa-workbook-verify/ui-drive-result.txt", ["UI_DRIVE_FAIL", ...log, String(error)].join("\n") + "\n");
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
