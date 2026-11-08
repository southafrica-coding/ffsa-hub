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
const APPROVER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const OUTSIDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const OTHER_LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const PENDING_LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const DEACTIVATED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
const REMOVED_LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0";
const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
const MINISTRY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OTHER_MINISTRY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const US_PERIOD = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
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

function prepareAccounts() {
  psql(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS first_name text,
      ADD COLUMN IF NOT EXISTS last_name text,
      ADD COLUMN IF NOT EXISTS gender text,
      ADD COLUMN IF NOT EXISTS marital_status text,
      ADD COLUMN IF NOT EXISTS date_of_birth date,
      ADD COLUMN IF NOT EXISTS nationality text,
      ADD COLUMN IF NOT EXISTS phone text,
      ADD COLUMN IF NOT EXISTS country text,
      ADD COLUMN IF NOT EXISTS address_line_1 text,
      ADD COLUMN IF NOT EXISTS city text,
      ADD COLUMN IF NOT EXISTS province text,
      ADD COLUMN IF NOT EXISTS postal_code text,
      ADD COLUMN IF NOT EXISTS emergency_contact_name text,
      ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
      ADD COLUMN IF NOT EXISTS emergency_contact_relationship text,
      ADD COLUMN IF NOT EXISTS health_insurance_provider text,
      ADD COLUMN IF NOT EXISTS health_insurance_policy_number text,
      ADD COLUMN IF NOT EXISTS health_insurance_expiry_date date,
      ADD COLUMN IF NOT EXISTS is_international boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS passport_country text,
      ADD COLUMN IF NOT EXISTS passport_number text,
      ADD COLUMN IF NOT EXISTS passport_expiry_date date;
    UPDATE public.users SET is_active = false WHERE id = '${DEACTIVATED}';
    UPDATE public.users SET
      first_name = 'Sam',
      last_name = 'Nkosi',
      gender = 'male',
      marital_status = 'single',
      date_of_birth = DATE '1995-01-01',
      nationality = 'South Africa',
      phone = '+27821234567',
      country = 'South Africa',
      address_line_1 = '1 Main Rd',
      city = 'Potchefstroom',
      province = 'North West',
      postal_code = '2520',
      emergency_contact_name = 'Ada',
      emergency_contact_phone = '+27821234568',
      emergency_contact_relationship = 'parent',
      health_insurance_provider = 'Discovery Health',
      health_insurance_policy_number = '123456',
      health_insurance_expiry_date = DATE '2030-06-01',
      is_international = false,
      passport_country = 'South Africa',
      passport_number = 'A1234567',
      passport_expiry_date = DATE '2030-01-01';
    INSERT INTO auth.users (id, email) VALUES
      ('${OTHER_LEADER}', 'other-leader@example.test'),
      ('${PENDING_LEADER}', 'pending-leader@example.test'),
      ('${DEACTIVATED}', 'inactive@example.test'),
      ('${OFFICE}', 'finance-office@example.test'),
      ('${REMOVED_LEADER}', 'removed-leader@example.test')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.users (id, display_name, is_active) VALUES
      ('${OTHER_LEADER}', 'Other leader', true),
      ('${PENDING_LEADER}', 'Pending leader', true),
      ('${DEACTIVATED}', 'Deactivated leader', false),
      ('${OFFICE}', 'Finance office', true),
      ('${REMOVED_LEADER}', 'Removed leader', true)
    ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;
    UPDATE public.users SET is_active = false WHERE id = '${DEACTIVATED}';
    INSERT INTO public.staff_ministries (id, name, slug)
    VALUES ('${OTHER_MINISTRY}', 'Media', 'media')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status) VALUES
      ('${OTHER_MINISTRY}', '${OTHER_LEADER}', 'leader', 'active'),
      ('${MINISTRY}', '${PENDING_LEADER}', 'leader', 'pending'),
      ('${OTHER_MINISTRY}', '${REMOVED_LEADER}', 'leader', 'active')
    ON CONFLICT (staff_ministry_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role, status = EXCLUDED.status;
    INSERT INTO public.roles (name, display_name, is_system)
    VALUES ('finance_office', 'Finance Office', true)
    ON CONFLICT (name) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role_id)
    SELECT '${OFFICE}', id FROM public.roles WHERE name = 'finance_office'
    ON CONFLICT DO NOTHING;
    UPDATE public.users SET is_active = false WHERE id = '${DEACTIVATED}';
    UPDATE public.users SET
      first_name = 'Sam', last_name = 'Nkosi', gender = 'male', marital_status = 'single',
      date_of_birth = DATE '1995-01-01', nationality = 'South Africa', phone = '+27821234567',
      country = 'South Africa', address_line_1 = '1 Main Rd', city = 'Potchefstroom',
      province = 'North West', postal_code = '2520', emergency_contact_name = 'Ada',
      emergency_contact_phone = '+27821234568', emergency_contact_relationship = 'parent',
      health_insurance_provider = 'Discovery Health', health_insurance_policy_number = '123456',
      health_insurance_expiry_date = DATE '2030-06-01', is_international = false,
      passport_country = 'South Africa', passport_number = 'A1234567', passport_expiry_date = DATE '2030-01-01';
  `);
  const bin = process.env.PGRST_BIN || "/tmp/ffsa-workbook-verify/postgrest";
  const conf = "/tmp/ffsa-workbook-verify/postgrest-3001.conf";
  spawnSync("tmux", ["-f", "/exec-daemon/tmux.portal.conf", "kill-session", "-t", "pgrst-3001"], { encoding: "utf8" });
  const started = spawnSync(
    "tmux",
    ["-f", "/exec-daemon/tmux.portal.conf", "new-session", "-d", "-s", "pgrst-3001", "--", bin, conf],
    { encoding: "utf8" }
  );
  if (started.status !== 0) throw new Error(`PostgREST restart failed: ${started.stderr}`);
  spawnSync("sleep", ["2"]);
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

async function openAs(browser, sub, path) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.setCookie({ name: "ffsa-harness-sub", value: sub, url: base });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle0" });
  return { context, page };
}

async function api(sub, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: `ffsa-harness-sub=${sub}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function roleMatrix(browser, financeBudgetId, financeName) {
  const leaderRoles = psql(
    `SELECT coalesce(string_agg(r.name, ','), '(none)') FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = '${LEADER}';`
  );
  assert(leaderRoles === "(none)", `owning leader roles were ${leaderRoles}`);

  const hidden = await api(LEADER, `/api/finance/budgets/${financeBudgetId}`);
  assert(hidden.status === 404, `leader read the finance-created budget ${hidden.status}`);
  const wrongOwner = await api(LEADER, "/api/finance/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Not their team ${Date.now().toString(36)}`,
      ownerKind: "staff_ministry",
      ownerId: OTHER_MINISTRY,
      periodId: PERIOD,
    }),
  });
  assert(wrongOwner.status === 403, `leader created another team's budget ${wrongOwner.status}`);

  const home = await openAs(browser, LEADER, "/finance/budgets");
  assert(new URL(home.page.url()).pathname === "/finance/budgets", `leader sheet url ${home.page.url()}`);
  const homeText = await bodyText(home.page);
  assert(!homeText.includes(financeName), "leader list showed a finance-created budget");
  assert(!homeText.includes("US year"), "leader sheet offered a US period before an owner");
  const discovered = await api(LEADER, `/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=${MINISTRY}`);
  assert(discovered.status === 200, `leader periods ${discovered.status} ${JSON.stringify(discovered.body).slice(0, 240)}`);
  const discoveredText = JSON.stringify(discovered.body);
  assert(discoveredText.includes("2026") && !discoveredText.includes("US year"), `leader period payload ${discoveredText}`);
  assert(!discoveredText.includes("orgId") && !discoveredText.includes("org_id"), "period payload included an organisation");
  const missingSelector = await api(LEADER, "/api/finance/budgets/periods");
  assert(missingSelector.status === 400, `missing selector ${missingSelector.status}`);
  const otherPeriods = await api(LEADER, `/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=${OTHER_MINISTRY}`);
  assert(otherPeriods.status === 403, `leader periods for another ministry ${otherPeriods.status}`);
  const unsigned = await fetch(`${base}/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=${MINISTRY}`);
  assert(unsigned.status === 401, `unsigned periods ${unsigned.status}`);
  await choose(home.page, "What this budget belongs to", "staff_ministry");
  await home.page.waitForFunction(() => document.body.innerText.includes("Worship"));
  const owners = await home.page.$eval('[aria-label="Owner"]', (el) => [...el.options].map((option) => option.textContent));
  assert(owners.includes("Worship"), `leader owners ${owners.join(", ")}`);
  assert(!owners.includes("Media"), `leader owners included Media: ${owners.join(", ")}`);
  await choose(home.page, "Owner", "Worship");
  await home.page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Period"] option')].some((option) => option.textContent.includes("2026")));
  const leaderPeriodText = await home.page.$eval('[aria-label="Period"]', (el) => el.innerText);
  assert(!leaderPeriodText.includes("US year"), `leader periods included a US period: ${leaderPeriodText}`);
  const leaderName = `Leader own ${Date.now().toString(36)}`;
  await setValue(home.page, 'input[placeholder="Name this budget"]', leaderName);
  await choose(home.page, "Period", "2026");
  await clickExact(home.page, "Fixed cost");
  await clickExact(home.page, "Add a line");
  await setValue(home.page, '[aria-label="Name for this line"]', "Van");
  await setValue(home.page, '[aria-label="Amount for Van"]', "100.00");
  await clickExact(home.page, "Create");
  await home.page.waitForFunction(() => /\/finance\/budgets\/[0-9a-f-]{36}/i.test(location.pathname), { timeout: 60000 });
  const leaderId = await home.page.evaluate(() => location.pathname.match(/\/finance\/budgets\/([0-9a-f-]{36})/i)[1]);
  await home.page.waitForFunction((name) => document.querySelector('input[placeholder="Name this budget"]')?.value === name, {}, leaderName);
  await home.page.reload({ waitUntil: "networkidle0" });
  await home.page.waitForFunction((name) => document.querySelector('input[placeholder="Name this budget"]')?.value === name, {}, leaderName);
  await clickExact(home.page, "Fixed cost");
  await home.page.waitForFunction(() => document.querySelector('[aria-label="Amount for Van"]')?.value === "100.00");
  await setValue(home.page, '[aria-label="Amount for Van"]', "250.00");
  await clickExact(home.page, "Save");
  await waitIdle(home.page);
  await home.page.reload({ waitUntil: "networkidle0" });
  await home.page.waitForFunction((name) => document.querySelector('input[placeholder="Name this budget"]')?.value === name, {}, leaderName);
  await clickExact(home.page, "Fixed cost");
  await home.page.waitForFunction(() => document.querySelector('[aria-label="Amount for Van"]')?.value === "250.00");
  const listed = await api(LEADER, `/api/finance/budgets?ownerKind=staff_ministry&ownerId=${MINISTRY}`);
  assert(listed.body.budgets?.some((row) => row.id === leaderId), "leader list missed their budget");
  assert(!listed.body.budgets?.some((row) => row.id === financeBudgetId), "leader list included the finance budget");
  await shot(home.page, "budget-leader-desktop", 1280);
  note("blank owning leader discovered a period, created, saved, and refreshed");
  await home.context.close();

  const created = { body: { budget: { id: leaderId } } };

  const other = await openAs(browser, OTHER_LEADER, "/finance/budgets");
  await choose(other.page, "What this budget belongs to", "staff_ministry");
  await other.page.waitForFunction(() => document.body.innerText.includes("Media"));
  const otherOwners = await other.page.$eval('[aria-label="Owner"]', (el) => [...el.options].map((option) => option.textContent));
  assert(otherOwners.includes("Media") && !otherOwners.includes("Worship"), `other leader owners ${otherOwners.join(", ")}`);
  const otherHidden = await api(OTHER_LEADER, `/api/finance/budgets/${created.body.budget.id}`);
  assert(otherHidden.status === 404, `other leader read Worship ${otherHidden.status}`);
  note("other-team leader sees Media only");
  await other.context.close();

  const pending = await openAs(browser, PENDING_LEADER, "/finance/budgets");
  assert(new URL(pending.page.url()).pathname === "/finance", `pending leader url ${pending.page.url()}`);
  const pendingCreate = await api(PENDING_LEADER, "/api/finance/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Pending", ownerKind: "staff_ministry", ownerId: MINISTRY, periodId: PERIOD }),
  });
  assert(pendingCreate.status === 403, `pending leader create ${pendingCreate.status}`);
  const pendingPeriods = await api(PENDING_LEADER, `/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=${MINISTRY}`);
  assert(pendingPeriods.status === 403, `pending leader periods ${pendingPeriods.status}`);
  note("pending leader is not an active lead and cannot open, list periods, or create");
  await pending.context.close();

  const removedBefore = await api(REMOVED_LEADER, `/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=${OTHER_MINISTRY}`);
  assert(removedBefore.status === 200, `removed-leader before delete ${removedBefore.status}`);
  psql(`DELETE FROM public.staff_ministry_members WHERE user_id = '${REMOVED_LEADER}';`);
  const removedAfter = await api(REMOVED_LEADER, `/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=${OTHER_MINISTRY}`);
  assert(removedAfter.status === 403, `removed leader periods ${removedAfter.status} ${JSON.stringify(removedAfter.body).slice(0, 180)}`);
  const removedPage = await openAs(browser, REMOVED_LEADER, "/finance/budgets");
  assert(new URL(removedPage.page.url()).pathname === "/finance", `removed leader url ${removedPage.page.url()}`);
  note("deleting the membership row removes period discovery; pending was not used as that proof");
  await removedPage.context.close();

  const office = await openAs(browser, OFFICE, "/finance");
  const officeLinks = await office.page.$$eval("a", (nodes) => nodes.map((node) => node.getAttribute("href")));
  assert(!officeLinks.includes("/finance/budgets"), `finance office saw budgets ${officeLinks.join(",")}`);
  const officeSheet = await openAs(browser, OFFICE, "/finance/budgets");
  assert(new URL(officeSheet.page.url()).pathname === "/finance", `finance office url ${officeSheet.page.url()}`);
  note("finance office without a budget permission does not get the sheet");
  await office.context.close();
  await officeSheet.context.close();

  const dead = await openAs(browser, DEACTIVATED, "/finance/budgets");
  assert(dead.page.url().includes("error=deactivated"), `deactivated url ${dead.page.url()}`);
  const deadApi = await api(DEACTIVATED, `/api/finance/budgets/periods?ownerKind=staff_ministry&ownerId=${MINISTRY}`);
  assert(deadApi.status === 403 && deadApi.body.error === "deactivated", `deactivated periods ${deadApi.status} ${JSON.stringify(deadApi.body).slice(0, 160)}`);
  note("deactivated account is sent to login, and the periods request is 403");
  await dead.context.close();

  const approver = await openAs(browser, APPROVER, `/finance/budgets/${financeBudgetId}`);
  await approver.page.waitForFunction(
    (name) => document.querySelector('input[placeholder="Name this budget"]')?.value === name,
    {},
    financeName
  );
  const approveButton = await approver.page.evaluate(
    () => [...document.querySelectorAll("button")].some((button) => /approve/i.test(button.textContent || ""))
  );
  assert(!approveButton, "the sheet offered an approve action");
  const approverLoad = await api(APPROVER, `/api/finance/budgets/${financeBudgetId}`);
  assert(approverLoad.status === 200, `approver load ${approverLoad.status}`);
  const approverWrite = await api(APPROVER, `/api/finance/budgets/${financeBudgetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updatedAt: approverLoad.body.budget.updatedAt, notes: "approver edit" }),
  });
  assert(approverWrite.status === 403, `approver structural save ${approverWrite.status} ${JSON.stringify(approverWrite.body).slice(0, 200)}`);
  note(`budget.approve can open the sheet and has no approve button; save returned ${approverWrite.status}`);
  await approver.context.close();

  const outsider = await openAs(browser, OUTSIDER, "/finance/budgets");
  assert(new URL(outsider.page.url()).pathname === "/finance", `outsider url ${outsider.page.url()}`);
  const outsiderRead = await api(OUTSIDER, `/api/finance/budgets/${financeBudgetId}`);
  assert(outsiderRead.status === 404, `outsider read ${outsiderRead.status}`);
  note("outsider cannot open the sheet or read the budget");
  await outsider.context.close();
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
    INSERT INTO public.fiscal_periods (id, org_id, label, kind, start_date, end_date, is_current)
    SELECT '${US_PERIOD}', id, 'US year', 'year', DATE '2026-01-01', DATE '2026-12-31', false
    FROM public.finance_orgs WHERE key = 'usa'
    ON CONFLICT (id) DO NOTHING;
  `);
  prepareAccounts();
  note("inserted NPC period 2026 and a US period the sheet must not offer");

  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  await page.setCookie({ name: "ffsa-harness-sub", value: FINANCE, domain: "127.0.0.1", path: "/" });
  await page.goto(`${base}/finance/budgets`, { waitUntil: "networkidle0" });
  const opened = await bodyText(page);
  writeFileSync("/tmp/ffsa-ui-budget-open.txt", opened);
  assert(/budget/i.test(opened), `finance page did not render the sheet:\n${opened.slice(0, 800)}`);
  assert(!opened.includes("Complete your profile"), "profile gate hid the sheet");
  assert(opened.includes("FFSA NPC"), "FFSA NPC was not on the sheet");
  assert(!opened.includes("US year"), "a US period was offered before an owner was chosen");
  note("empty sheet shows FFSA NPC and waits for an owner before listing periods");

  await setValue(page, 'input[placeholder="Name this budget"]', NAME);
  await choose(page, "What this budget belongs to", "staff_ministry");
  await page.waitForFunction(() => document.body.innerText.includes("Worship"));
  await choose(page, "Owner", "Worship");
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Period"] option')].some((option) => option.textContent.includes("2026")));
  const financePeriodText = await page.$eval('[aria-label="Period"]', (el) => el.innerText);
  assert(!financePeriodText.includes("US year"), `finance periods included a US period: ${financePeriodText}`);
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

  await roleMatrix(browser, id, NAME);

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
