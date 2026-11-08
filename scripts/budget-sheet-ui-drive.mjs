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
const OUTSIDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const MINISTRY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
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

  const submitted = psql(`UPDATE public.budgets SET status = 'submitted' WHERE id = '${id}' RETURNING status;`);
  assert(submitted === "submitted", `status update returned ${submitted}`);
  await page.reload({ waitUntil: "networkidle0" });
  const submittedText = await bodyText(page);
  assert(submittedText.includes("This budget is submitted. Only finance can change it."), "submitted note missing");
  await clickExact(page, "Expense tracker");
  await clickExact(page, "Add an expense");
  await setValue(page, '[aria-label="Expense date"]', "2026-03-02");
  await setValue(page, '[aria-label="What the expense was for"]', "Tea for the team");
  await setValue(page, '[aria-label="Expense amount"]', "40.00");
  await clickExact(page, "Save");
  await waitIdle(page);
  await page.reload({ waitUntil: "networkidle0" });
  await clickExact(page, "Expense tracker");
  await page.waitForFunction(() => document.querySelector('[aria-label="Expense amount"]')?.value === "40.00");
  await setValue(page, '[aria-label="Expense amount"]', "45.00");
  await clickExact(page, "Save");
  await waitIdle(page);
  await page.reload({ waitUntil: "networkidle0" });
  await clickExact(page, "Expense tracker");
  await page.waitForFunction(() => document.querySelector('[aria-label="Expense amount"]')?.value === "45.00");
  note("submitted tracker add and edit survived refresh");
  await shot(page, "budget-submitted-desktop", 1280);
  await shot(page, "budget-submitted-320", 320);

  await clickExact(page, "Variable cost");
  await setValue(page, '[aria-label="Amount for Food"]', "250.00");
  const approved = psql(`UPDATE public.budgets SET status = 'approved' WHERE id = '${id}' RETURNING status;`);
  assert(approved === "approved", `approve update returned ${approved}`);
  await clickExact(page, "Save");
  await waitIdle(page);
  const remoteText = await bodyText(page);
  assert(!/doesn't submit or approve/i.test(remoteText), `save tried to change status: ${remoteText.slice(0, 400)}`);
  assert(/Nothing you typed was overwritten/i.test(remoteText), `remote approval notice: ${remoteText.slice(0, 400)}`);
  const typedAmount = await page.$eval('[aria-label="Amount for Food"]', (el) => el.value);
  assert(typedAmount === "250.00", `remote approval dropped the typed amount ${typedAmount}`);
  const storedLine = psql(`SELECT amount_cents FROM public.budget_lines WHERE budget_id = '${id}' AND name = 'Food';`);
  assert(storedLine === "19000", `structural edit was stored as ${storedLine}`);
  const storedTea = psql(`SELECT amount_cents FROM public.budget_expenses WHERE budget_id = '${id}' AND description = 'Tea for the team';`);
  assert(storedTea === "4500", `submitted expense changed during the rejected line save: ${storedTea}`);
  note("remote approval kept the typed line and did not change status from the sheet");

  await page.reload({ waitUntil: "networkidle0" });
  const lockedText = await bodyText(page);
  assert(lockedText.includes("The expense tracker can still be updated."), "approved tracker copy missing");
  await clickExact(page, "Variable cost");
  const lineLocked = await page.$eval(
    '[aria-label="Amount for Food"]',
    (el) => el.matches(":disabled") && el.value === "190.00"
  );
  assert(lineLocked, "approved line amount is still editable");
  await clickExact(page, "Expense tracker");
  const trackerOpen = await page.$eval(
    '[aria-label="Expense amount"]',
    (el) => !el.matches(":disabled") && el.value === "45.00"
  );
  assert(trackerOpen, "approved tracker amount is locked or not 45.00");
  await setValue(page, '[aria-label="Expense amount"]', "55.00");
  await clickExact(page, "Save");
  await waitIdle(page);
  await page.reload({ waitUntil: "networkidle0" });
  await clickExact(page, "Expense tracker");
  await page.waitForFunction(() => document.querySelector('[aria-label="Expense amount"]')?.value === "55.00");
  await clickExact(page, "Add an expense");
  const expenseDates = await page.$$('[aria-label="Expense date"]');
  const expenseNames = await page.$$('[aria-label="What the expense was for"]');
  const expenseAmounts = await page.$$('[aria-label="Expense amount"]');
  await expenseDates[1].evaluate((el) => {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    desc.set.call(el, "2026-03-03");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expenseNames[1].evaluate((el) => {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    desc.set.call(el, "Bread");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expenseAmounts[1].evaluate((el) => {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    desc.set.call(el, "20.00");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clickExact(page, "Save");
  await waitIdle(page);
  await page.reload({ waitUntil: "networkidle0" });
  await clickExact(page, "Expense tracker");
  await page.waitForFunction(() => document.body.innerText.length >= 0 && document.querySelectorAll('[aria-label="What the expense was for"]').length === 2);
  const beforeRemove = await page.$$eval('[aria-label="What the expense was for"]', (els) => els.map((el) => el.value));
  assert(beforeRemove.includes("Tea for the team") && beforeRemove.includes("Bread"), `approved rows ${beforeRemove.join(", ")}`);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")];
    const tea = rows.find((row) => row.querySelector('[aria-label="What the expense was for"]')?.value === "Tea for the team");
    tea.querySelector("button").click();
  });
  await clickExact(page, "Save");
  await waitIdle(page);
  await page.reload({ waitUntil: "networkidle0" });
  await clickExact(page, "Expense tracker");
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="What the expense was for"]').length === 1);
  const left = await page.$eval('[aria-label="What the expense was for"]', (el) => el.value);
  assert(left === "Bread", `remove left ${left}`);
  const lineAfter = psql(`SELECT amount_cents FROM public.budget_lines WHERE budget_id = '${id}' AND name = 'Food';`);
  assert(lineAfter === "19000", `approved tracker save changed the line to ${lineAfter}`);
  const fresh = await readBudget(page, id);
  const structural = await fetch(`${base}/api/finance/budgets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `ffsa-harness-sub=${FINANCE}` },
    body: JSON.stringify({
      updatedAt: fresh.budget.updatedAt,
      lines: fresh.budget.lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        name: line.name,
        amountCents: line.name === "Food" ? 5 : line.amountCents,
        frequency: line.frequency,
        multiplier: line.multiplier,
      })),
      expenses: fresh.budget.expenses.map((row) => ({
        id: row.id,
        lineId: row.lineId,
        expenseDate: row.expenseDate,
        description: row.description,
        amountCents: row.amountCents,
      })),
    }),
  });
  assert(structural.status === 403, `fresh structural save ${structural.status} ${JSON.stringify(await structural.clone().json()).slice(0, 240)}`);
  const lineStill = psql(`SELECT amount_cents FROM public.budget_lines WHERE budget_id = '${id}' AND name = 'Food';`);
  assert(lineStill === "19000", `fresh structural save stored ${lineStill}`);
  note("approved tracker edit, add, and remove survived refresh; a current-revision line change was refused");
  await shot(page, "budget-approved-desktop", 1280);
  await shot(page, "budget-approved-320", 320);

  const leaderContext = await browser.createBrowserContext();
  const leaderPage = await leaderContext.newPage();
  await leaderPage.setCookie({ name: "ffsa-harness-sub", value: LEADER, url: base });
  await leaderPage.goto(`${base}/finance/budgets/${id}`, { waitUntil: "networkidle0" });
  const leaderUrl = leaderPage.url();
  let leaderText = "";
  try {
    leaderText = await bodyText(leaderPage);
  } catch {
    leaderText = "(page navigated before the text could be read)";
  }
  writeFileSync("/tmp/ffsa-ui-budget-leader.txt", `${leaderUrl}\n${leaderText.slice(0, 1500)}`);
  assert(new URL(leaderUrl).pathname === "/finance", `leader stayed on ${leaderUrl}`);
  const leaderRoles = psql(
    `SELECT coalesce(string_agg(r.name, ','), '(none)') FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = '${LEADER}';`
  );
  note(`leader page gate redirected to /finance. user_roles=${leaderRoles}. This is not an owning-leader sheet pass.`);
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
  note(`non-member leader write on the finance-created budget returned ${leaderWrite.status}; notes unchanged`);

  const leaderLine = crypto.randomUUID();
  const leaderName = `Leader own ${Date.now().toString(36)}`;
  const leaderCreate = await fetch(`${base}/api/finance/budgets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `ffsa-harness-sub=${LEADER}` },
    body: JSON.stringify({
      name: leaderName,
      ownerKind: "staff_ministry",
      ownerId: MINISTRY,
      periodId: PERIOD,
      lines: [{ id: leaderLine, kind: "fixed", name: "Van", amountCents: 100, multiplier: 1 }],
    }),
  });
  const leaderCreated = await leaderCreate.json();
  assert(leaderCreate.status === 201, `owning leader create ${leaderCreate.status} ${JSON.stringify(leaderCreated).slice(0, 300)}`);
  const leaderId = leaderCreated.budget.id;
  const leaderSave = await fetch(`${base}/api/finance/budgets/${leaderId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `ffsa-harness-sub=${LEADER}` },
    body: JSON.stringify({
      updatedAt: leaderCreated.budget.updatedAt,
      lines: [{ id: leaderLine, kind: "fixed", name: "Van", amountCents: 250, multiplier: 1 }],
    }),
  });
  const leaderSaved = await leaderSave.json();
  assert(leaderSave.status === 200, `owning leader save ${leaderSave.status} ${JSON.stringify(leaderSaved).slice(0, 300)}`);
  assert(leaderSaved.budget.lines[0].amountCents === 250, "owning leader save did not store 250");
  const leaderList = await fetch(
    `${base}/api/finance/budgets?ownerKind=staff_ministry&ownerId=${MINISTRY}`,
    { headers: { Cookie: `ffsa-harness-sub=${LEADER}` } }
  );
  const leaderListed = await leaderList.json();
  assert(leaderList.status === 200 && leaderListed.budgets.some((row) => row.id === leaderId), "owning leader list missed the budget");
  const outsiderWrite = await fetch(`${base}/api/finance/budgets/${leaderId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `ffsa-harness-sub=${OUTSIDER}` },
    body: JSON.stringify({ updatedAt: leaderSaved.budget.updatedAt, notes: "outsider" }),
  });
  assert(outsiderWrite.status === 404 || outsiderWrite.status === 403, `outsider write ${outsiderWrite.status}`);
  note(`API owning-leader create/load/save/list returned 201/200. Outsider write ${outsiderWrite.status}. The sheet page still redirects this leader.`);

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
