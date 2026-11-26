// Maintenance requests (migration 405) — the rules, the words and the Slack
// messages, built as plain data. Sending lives in maintenance-slack.ts.
//
//   request form      the modal the "New maintenance request" button opens
//   request post      what #maintenance-request-submissions sees
//   WhatsApp copy     plain text in the post's thread, to paste for the crew
//   follow-up         07:00 Mon–Fri: active requests and how old they are
//   monthly report    numbers for the operations meeting (Hub only)
//
// Three statuses for maintenance, over the six the database keeps:
//   Not started = new / seen · In progress = in_progress / more_time ·
//   Finished = done. (Won't do stays a Hub-only choice.)

import { isClosed, type ItemStatus, type OpsItem } from "./areas";
import { dayLabel, daysBetween, sastDate } from "./dates";
import { esc, itemUrl, type Block, type Message } from "./messages";

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";
export const reportUrl = (month?: string) => `${SITE}/operations/maintenance/report${month ? `?month=${month}` : ""}`;

// ── Slack ids ───────────────────────────────────────────────
// All start with ops_ so the interactions route hands them to Operations.
export const MAINT_NEW = "ops_m_new"; //            the button → opens the form
export const MAINT_RULES_VIEW = "ops_m_rules"; //   step 1: the rules, "I agree"
export const MAINT_VIEW = "ops_m_request"; //       step 2: the form
export const MAINT_SET = "ops_m_set"; //            a status button on the post
export const MAINT_PICK = "ops_m_pick"; //          the status dropdown in the follow-up
export const MAINT_NOTE = "ops_m_note"; //          "Add a note" on the post
export const MAINT_OPEN = "ops_m_open"; //          "Open in Hub" (a link; nothing to do)
export const isMaintAction = (id: string) => id.startsWith("ops_m_");

// ── Urgency ─────────────────────────────────────────────────

export const URGENCIES = [
  { key: "urgent", label: "Urgent", hint: "Not safe, or no water / power", emoji: "🔴" },
  { key: "this_week", label: "This week", hint: "Needs doing soon", emoji: "🟡" },
  { key: "when_you_can", label: "When you can", hint: "No rush", emoji: "⚪" },
] as const;
export type Urgency = (typeof URGENCIES)[number]["key"];
export const isUrgency = (v: unknown): v is Urgency => URGENCIES.some((u) => u.key === v);
const urgencyOf = (v: string | null | undefined) => URGENCIES.find((u) => u.key === v) ?? null;
export const urgencyLabel = (v: string | null | undefined) => urgencyOf(v)?.label ?? null;

// ── The three statuses ──────────────────────────────────────

export const MAINT_STATUSES = ["not_started", "in_progress", "finished"] as const;
export type MaintStatus = (typeof MAINT_STATUSES)[number];
export const isMaintStatus = (v: unknown): v is MaintStatus => (MAINT_STATUSES as readonly unknown[]).includes(v);

export const MAINT_LABEL: Record<MaintStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  finished: "Finished",
};

/** What each choice writes to ops_items.status. */
export const TO_ITEM_STATUS: Record<MaintStatus, ItemStatus> = {
  not_started: "new",
  in_progress: "in_progress",
  finished: "done",
};

/** An item's status in the three words; null for "won't do". */
export function maintStatus(s: ItemStatus): MaintStatus | null {
  if (s === "new" || s === "seen") return "not_started";
  if (s === "in_progress" || s === "more_time") return "in_progress";
  if (s === "done") return "finished";
  return null;
}

// ── Working hours ───────────────────────────────────────────
// The crew's hours, SAST, by weekday (0 = Sunday). A day that isn't
// listed is closed. From Mache's base orientation document.

export type DayHours = { open: string; close: string };
export type WorkingHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DayHours>>;

export const DEFAULT_HOURS: WorkingHours = {
  "1": { open: "08:00", close: "16:00" },
  "2": { open: "08:00", close: "16:00" },
  "3": { open: "08:00", close: "16:00" },
  "4": { open: "08:00", close: "16:00" },
  "5": { open: "08:00", close: "15:00" },
};

/** {when} becomes "later today at 08:00", "first thing tomorrow" or "first thing on Monday". */
export const DEFAULT_NOTICE =
  "Working hours for our Maintenance Crew are Monday to Thursday 08:00–16:00 and Friday 08:00–15:00. Your request will be handled {when}.";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Working hours from a settings value; anything malformed is dropped (that day closed). */
export function hoursFrom(v: unknown): WorkingHours {
  if (!v || typeof v !== "object" || Array.isArray(v)) return DEFAULT_HOURS;
  const out: WorkingHours = {};
  for (const d of ["0", "1", "2", "3", "4", "5", "6"] as const) {
    const day = (v as Record<string, unknown>)[d] as { open?: unknown; close?: unknown } | undefined;
    const open = typeof day?.open === "string" ? day.open.slice(0, 5) : "";
    const close = typeof day?.close === "string" ? day.close.slice(0, 5) : "";
    if (HHMM.test(open) && HHMM.test(close) && minutes(open) < minutes(close)) out[d] = { open, close };
  }
  return out;
}

/** SAST weekday and minutes since midnight. */
function sastClock(at: Date) {
  const t = new Date(at.getTime() + 2 * 3600_000); // SAST, no DST
  return { dow: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const dayOf = (h: WorkingHours, dow: number) => h[String(dow) as keyof WorkingHours];

/** Outside the crew's hours? With no hours at all, never. */
export function isOutOfHours(at: Date, hours: WorkingHours = DEFAULT_HOURS): boolean {
  if (Object.keys(hours).length === 0) return false;
  const { dow, min } = sastClock(at);
  const today = dayOf(hours, dow);
  return !today || min < minutes(today.open) || min >= minutes(today.close);
}

/** When the crew is next in, in words: "later today at 08:00", "first thing tomorrow", "first thing on Monday". */
export function whenWords(at: Date, hours: WorkingHours = DEFAULT_HOURS): string {
  const { dow, min } = sastClock(at);
  const today = dayOf(hours, dow);
  if (today && min < minutes(today.open)) return `later today at ${today.open}`;
  for (let ahead = 1; ahead <= 7; ahead++) {
    const d = (dow + ahead) % 7;
    if (dayOf(hours, d)) return ahead === 1 ? "first thing tomorrow" : `first thing on ${DAY_NAMES[d]}`;
  }
  return "as soon as the crew is back";
}

/** The out-of-hours message with {when} filled in. */
export function hoursNotice(template: string | null | undefined, at: Date, hours: WorkingHours = DEFAULT_HOURS): string {
  return (template?.trim() || DEFAULT_NOTICE).replace(/\{when\}/g, whenWords(at, hours));
}

// ── Words ───────────────────────────────────────────────────

/** "14:10" in SAST. */
export function sastTime(at: string | Date): string {
  const t = new Date(new Date(at).getTime() + 2 * 3600_000);
  return t.toISOString().slice(11, 16);
}

/** How long a request has been waiting: "today", "1 day", "16 days". */
export function ageWords(createdAt: string, now: Date = new Date()): string {
  const n = daysBetween(sastDate(createdAt), sastDate(now));
  if (n <= 0) return "today";
  return n === 1 ? "1 day" : `${n} days`;
}

export const ageDays = (createdAt: string, now: Date = new Date()) =>
  Math.max(0, daysBetween(sastDate(createdAt), sastDate(now)));

/** "Thu 26 Nov, 14:10" */
const whenAsked = (at: string) => `${dayLabel(sastDate(at))}, ${sastTime(at)}`;

const section = (text: string, accessory?: Block): Block =>
  accessory ? { type: "section", text: { type: "mrkdwn", text }, accessory } : { type: "section", text: { type: "mrkdwn", text } };
const context = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
const plain = (text: string) => ({ type: "plain_text", text, emoji: true });
const button = (text: string, action_id: string, value: string, style?: "primary" | "danger"): Block => ({
  type: "button",
  text: plain(text),
  action_id,
  value,
  ...(style ? { style } : {}),
});

/** Slack mrkdwn quote of what someone typed. */
const quote = (s: string) => `> ${esc(s.trim()).replace(/\n/g, "\n> ")}`;

// ── The button message (posted once, then pinned by hand) ───

export function buttonMessage(): Message {
  return {
    text: "Need something fixed? Send a maintenance request.",
    blocks: [
      section("*Need something fixed?*\nTap the button to send a maintenance request. The rules are on the first screen."),
      { type: "actions", elements: [button("New maintenance request", MAINT_NEW, "new", "primary")] },
    ],
  };
}

// ── Step 1: the rules (every time) ──────────────────────────
// The button always opens this first. "I agree" sits under the last rule,
// so it can only be ticked after scrolling through them all. Slack can't
// tell the Hub whether someone actually read them; this is as close as a
// Slack modal gets. Continue swaps it for the form.

/** The rules as sections, one per paragraph or bullet group, so long text stays readable. */
export function rulesBlocks(rules: string): Block[] {
  const parts = rules
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Slack sections take 3000 characters; the settings cap rules at 2500.
  return parts.slice(0, 40).map((p) => section(esc(p)));
}

export function rulesView(rules: string): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: MAINT_RULES_VIEW,
    title: plain("Before you ask"),
    submit: plain("Continue"),
    close: plain("Cancel"),
    blocks: [
      section("*Please read these before sending a maintenance request.*"),
      { type: "divider" },
      ...rulesBlocks(rules),
      { type: "divider" },
      {
        type: "input",
        block_id: "agree",
        label: plain("Your agreement"),
        element: {
          type: "checkboxes",
          action_id: "v",
          options: [{ text: plain("I've read the rules above and I agree"), value: "agree" }],
        },
      },
    ],
  };
}

// ── Step 2: the form ────────────────────────────────────────

export function requestForm(opts: { outOfHours: boolean; notice: string }): Record<string, unknown> {
  const blocks: Block[] = [];
  if (opts.outOfHours) blocks.push(section(`⏰ ${esc(opts.notice)}`), { type: "divider" });
  blocks.push(
    {
      type: "input",
      block_id: "issue",
      label: plain("What's wrong?"),
      element: {
        type: "plain_text_input",
        action_id: "v",
        multiline: true,
        min_length: 3,
        max_length: 2000,
        placeholder: plain("e.g. No hot water in the bathroom since Monday"),
      },
    },
    {
      type: "input",
      block_id: "where",
      label: plain("Where is it?"),
      hint: plain("Building and room, e.g. A6, main kitchen, front gate"),
      element: { type: "plain_text_input", action_id: "v", max_length: 120 },
    },
    {
      type: "input",
      block_id: "urgency",
      label: plain("How urgent is it?"),
      element: {
        type: "radio_buttons",
        action_id: "v",
        options: URGENCIES.map((u) => ({ text: plain(`${u.emoji} ${u.label}`), description: plain(u.hint), value: u.key })),
      },
    },
    {
      type: "input",
      block_id: "photo",
      optional: true,
      label: plain("Photos (optional)"),
      element: { type: "file_input", action_id: "v", filetypes: ["jpg", "jpeg", "png", "heic", "gif", "webp"], max_files: 3 },
    }
  );
  return {
    type: "modal",
    callback_id: MAINT_VIEW,
    title: plain("Maintenance request"),
    submit: plain("Send"),
    close: plain("Cancel"),
    blocks,
  };
}

/** What the form turns into once it's sent. */
export function sentView(notice: string | null): Record<string, unknown> {
  const blocks: Block[] = [section("*Thanks, your request is in.*")];
  if (notice) blocks.push(section(`⏰ ${esc(notice)}`));
  blocks.push(context("You'll get a Slack message when it's being worked on and when it's finished."));
  return { type: "modal", title: plain("Maintenance request"), close: plain("Close"), blocks };
}

// ── To the person who asked ─────────────────────────────────

export function confirmationMessage(item: OpsItem, notice: string | null): Message {
  const where = item.location ? ` (${esc(item.location)})` : "";
  const text = `Thanks, your maintenance request *${esc(item.title)}*${where} is in.`;
  const blocks: Block[] = [section(text)];
  if (notice) blocks.push(section(`⏰ ${esc(notice)}`));
  blocks.push(context("You'll get a message here when it's being worked on and when it's finished."));
  return { text: text.replace(/\*/g, ""), blocks };
}

// ── The request post (#maintenance-request-submissions) ─────

export function requestPost(item: OpsItem): Message {
  const u = urgencyOf(item.urgency);
  const status = maintStatus(item.status);
  const line2 = [
    `📍 ${item.location ? `*${esc(item.location)}*` : "_no location given_"}`,
    u ? `${u.emoji} ${u.label}` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");
  const asked = [
    `👤 Asked by ${esc(item.requested_by_name ?? "someone")}`,
    whenAsked(item.created_at),
    item.out_of_hours ? "out of hours" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks: Block[] = [section(`🔧 *${esc(item.title)}*\n${line2}`), context(asked)];
  // The title is the first line of what they typed; show the rest.
  if (item.details && item.details.trim() !== item.title.trim()) blocks.push(section(quote(item.details)));
  const foot = [
    `Status: *${status ? MAINT_LABEL[status] : "Won't do"}*`,
    item.photo_count ? `📷 ${item.photo_count === 1 ? "1 photo" : `${item.photo_count} photos`} in the thread` : null,
    "WhatsApp copy in the thread",
  ]
    .filter(Boolean)
    .join(" · ");
  blocks.push(context(foot));

  const actions: Block[] = MAINT_STATUSES.filter((s) => s !== status).map((s) =>
    button(s === "not_started" ? "Not started" : s === "in_progress" ? "In progress" : "Finished", `${MAINT_SET}:${s}`, `${s}|${item.id}`, s === "finished" ? "primary" : undefined)
  );
  actions.push(button("Add a note", MAINT_NOTE, item.id));
  actions.push({ type: "button", text: plain("Open in Hub"), action_id: MAINT_OPEN, url: itemUrl(item.id) });
  blocks.push({ type: "actions", elements: actions });

  return { text: `Maintenance: ${item.title}${item.location ? ` (${item.location})` : ""}`, blocks };
}

// ── The WhatsApp copy ───────────────────────────────────────
// Plain text, no Slack formatting: what you copy from Slack is what the
// crew reads. Post it escaped (esc) so Slack shows it exactly.

export function whatsappText(item: OpsItem): string {
  const u = urgencyOf(item.urgency);
  const lines = [`🔧 MAINTENANCE – ${item.title}`, `📍 Where: ${item.location ?? "not given"}`];
  if (u) lines.push(`${u.emoji} ${u.label}`);
  if (item.details && item.details.trim() !== item.title.trim()) lines.push(`📝 ${item.details.trim()}`);
  lines.push(`👤 Asked by ${item.requested_by_name ?? "someone"}, ${whenAsked(item.created_at)}`);
  if (item.photo_count) lines.push(`📷 ${item.photo_count === 1 ? "1 photo" : `${item.photo_count} photos`} in Slack`);
  return lines.join("\n");
}

// ── The 07:00 follow-up ─────────────────────────────────────

const OLD_DAYS = 14;
const CAP = 40; // Slack's 50 blocks, less the frame

const byAge = (a: OpsItem, b: OpsItem) => a.created_at.localeCompare(b.created_at);

/** Active requests in their two groups, oldest first. */
export function activeGroups(items: OpsItem[]) {
  const open = items.filter((i) => !isClosed(i.status)).sort(byAge);
  return {
    notStarted: open.filter((i) => maintStatus(i.status) === "not_started"),
    inProgress: open.filter((i) => maintStatus(i.status) === "in_progress"),
  };
}

function statusSelect(item: OpsItem): Block {
  const current = maintStatus(item.status) ?? "not_started";
  const option = (s: MaintStatus) => ({ text: plain(MAINT_LABEL[s]), value: `${s}|${item.id}` });
  return {
    type: "static_select",
    action_id: MAINT_PICK,
    options: MAINT_STATUSES.map(option),
    initial_option: option(current),
  };
}

function followupLine(item: OpsItem, now: Date): string {
  const u = urgencyOf(item.urgency);
  const first = `*<${itemUrl(item.id)}|${esc(item.title)}>* — ${esc(item.location ?? "no location")} · ${ageWords(item.created_at, now)}`;
  const second = [u && u.key !== "when_you_can" ? `${u.emoji} ${u.label}` : null, item.requested_by_name ? `asked by ${esc(item.requested_by_name)}` : null]
    .filter(Boolean)
    .join(" · ");
  return second ? `${first}\n${second}` : first;
}

/**
 * @param items     every open maintenance request
 * @param finished  requests finished since the last follow-up
 */
export function followupMessage(items: OpsItem[], finished: OpsItem[], now: Date = new Date()): Message {
  const { notStarted, inProgress } = activeGroups(items);
  const active = notStarted.length + inProgress.length;
  const old = [...notStarted, ...inProgress].filter((i) => ageDays(i.created_at, now) >= OLD_DAYS).length;
  const today = sastDate(now);

  const summary = [
    active === 1 ? "1 active request" : `${active} active requests`,
    old ? `${old} older than 2 weeks` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks: Block[] = [
    { type: "header", text: plain(`Maintenance · ${dayLabel(today)}`) },
    context(summary),
  ];

  let room = CAP;
  const group = (title: string, list: OpsItem[]) => {
    if (list.length === 0) return;
    blocks.push(section(`*${title.toUpperCase()}* (${list.length})`));
    const shown = list.slice(0, Math.max(0, room));
    room -= shown.length;
    for (const i of shown) blocks.push(section(followupLine(i, now), statusSelect(i)));
    if (list.length > shown.length) blocks.push(context(`+${list.length - shown.length} more in the Hub`));
  };
  group("Not started", notStarted);
  group("In progress", inProgress);

  if (active === 0) blocks.push(section("No active maintenance requests."));
  if (finished.length) {
    const names = finished.slice(0, 12).map((i) => `${esc(i.title)}${i.location ? ` (${esc(i.location)})` : ""}`);
    blocks.push(context(`✓ Finished since the last message: ${names.join(" · ")}${finished.length > 12 ? ` +${finished.length - 12} more` : ""}`));
  }
  blocks.push(
    context(
      `Change a status with the dropdown next to each request. The crew's list for WhatsApp is in the thread. <${reportUrl()}|This month's report>`
    )
  );

  return { text: `Maintenance: ${summary}`, blocks: blocks.slice(0, 50) };
}

/** The day's list for the crew's WhatsApp group. */
export function crewListText(items: OpsItem[], now: Date = new Date()): string | null {
  const { notStarted, inProgress } = activeGroups(items);
  if (notStarted.length + inProgress.length === 0) return null;
  const line = (i: OpsItem, n: number) => {
    const u = urgencyOf(i.urgency);
    const urgent = u?.key === "urgent" ? " 🔴 URGENT" : "";
    return `${n}. ${i.title} – ${i.location ?? "no location"} (${ageWords(i.created_at, now)})${urgent}`;
  };
  const out = [`🔧 Maintenance – ${dayLabel(sastDate(now))}`];
  if (inProgress.length) out.push("", "IN PROGRESS", ...inProgress.map((i, k) => line(i, k + 1)));
  if (notStarted.length) out.push("", "NOT STARTED", ...notStarted.map((i, k) => line(i, inProgress.length + k + 1)));
  return out.join("\n");
}

// ── The monthly report ──────────────────────────────────────

export type MonthReport = {
  month: string; // YYYY-MM
  logged: OpsItem[]; // came in this month
  finished: OpsItem[]; // finished this month (whenever they came in)
  stillOpen: OpsItem[]; // open now, whenever they came in
  avgDaysToFinish: number | null; // over `finished`
  repeatLocations: { location: string; count: number; titles: string[] }[]; // 2+ this month
  byUrgency: { key: string; label: string; count: number }[];
};

/** "2026-11" → [first instant, first instant of next month), SAST. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 2 * 3600_000);
  const end = new Date(Date.UTC(y, m, 1) - 2 * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** @param items  maintenance requests logged, finished or open in the month */
export function monthReport(items: OpsItem[], month: string): MonthReport {
  const { start, end } = monthBounds(month);
  const inMonth = (iso: string | null) => !!iso && new Date(iso) >= new Date(start) && new Date(iso) < new Date(end);

  const logged = items.filter((i) => inMonth(i.created_at)).sort(byAge);
  const finished = items
    .filter((i) => i.status === "done" && inMonth(i.closed_at))
    .sort((a, b) => (a.closed_at ?? "").localeCompare(b.closed_at ?? ""));
  const stillOpen = items.filter((i) => !isClosed(i.status)).sort(byAge);

  const days = finished.map((i) => (new Date(i.closed_at!).getTime() - new Date(i.created_at).getTime()) / 86_400_000);
  const avgDaysToFinish = days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null;

  const places = new Map<string, { location: string; count: number; titles: string[] }>();
  for (const i of logged) {
    const loc = i.location?.trim();
    if (!loc) continue;
    const key = loc.toLowerCase().replace(/\s+/g, " ");
    const p = places.get(key) ?? { location: loc, count: 0, titles: [] };
    p.count += 1;
    p.titles.push(i.title);
    places.set(key, p);
  }
  const repeatLocations = [...places.values()].filter((p) => p.count >= 2).sort((a, b) => b.count - a.count);

  const byUrgency = [
    ...URGENCIES.map((u) => ({ key: u.key as string, label: u.label, count: logged.filter((i) => i.urgency === u.key).length })),
    { key: "none", label: "Not said", count: logged.filter((i) => !isUrgency(i.urgency)).length },
  ].filter((u) => u.count > 0);

  return { month, logged, finished, stillOpen, avgDaysToFinish, repeatLocations, byUrgency };
}
