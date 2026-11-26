// Operations — the Slack messages, built as plain data (no sending here).
//
//   morning   07:00 Mon–Fri, one per area, in that area's channel
//   personal  07:00 DM to anyone holding an open item with their name on it
//   reminder  DM: given to you · due tomorrow · due today · past its date
//   weekly    Tuesday 17:00, ops channel — the meeting's reading
//   requester DM to whoever asked, when their request moves
//
// Tone: plain, and never about anyone's performance. Stuck things show as
// stuck; nothing here names who is "behind".

import { AREAS, QUIET_DAYS, STATUS_LABEL, areaLabel, isClosed, type ItemStatus, type OpsItem } from "./areas";
import { dayLabel, daysBetween, dueWords, sastDate } from "./dates";

export type Block = Record<string, unknown>;
export type Message = { text: string; blocks: Block[] };

export const OPS_ITEM_ACTION = "ops_item";
export const OPS_UPDATE_VIEW = "ops_update";
export const isOpsAction = (id: string) => id.startsWith("ops_");

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";
export const itemUrl = (id: string) => `${SITE}/operations/items/${id}`;
export const weekUrl = () => `${SITE}/operations/week`;
export const areaUrl = (area: string) => `${SITE}/operations?area=${area}`;

const section = (text: string, accessory?: Block): Block =>
  accessory ? { type: "section", text: { type: "mrkdwn", text }, accessory } : { type: "section", text: { type: "mrkdwn", text } };
const context = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
const header = (text: string): Block => ({ type: "header", text: { type: "plain_text", text } });
const divider = (): Block => ({ type: "divider" });

/** Slack mrkdwn: escape the three characters Slack treats as markup. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── one item ────────────────────────────────────────────────

const opt = (text: string, value: string) => ({ text: { type: "plain_text", text }, value });

/** The ⋯ menu on an item: the four quick answers, a note, and the Hub. */
export function itemMenu(id: string): Block {
  return {
    type: "overflow",
    action_id: OPS_ITEM_ACTION,
    options: [
      opt("Done", `done|${id}`),
      opt("Seen it", `seen|${id}`),
      opt("Working on it", `in_progress|${id}`),
      opt("Needs more time…", `more_time|${id}`),
      opt("Add a note…", `note|${id}`),
      { ...opt("Open in Hub", `open|${id}`), url: itemUrl(id) },
    ],
  };
}

export function itemLine(item: OpsItem, today: string): string {
  const where = item.location ? ` · ${esc(item.location)}` : "";
  const bits: string[] = [STATUS_LABEL[item.status]];
  if (item.owner_name) bits.push(esc(item.owner_name));
  if (item.due_on && !isClosed(item.status)) bits.push(dueWords(item.due_on, today));
  if (item.requested_by_name && item.source === "slack") bits.push(`asked by ${esc(item.requested_by_name)}`);
  return `*<${itemUrl(item.id)}|${esc(item.title)}>*${where}\n${bits.join(" · ")}`;
}

const itemBlock = (item: OpsItem, today: string): Block => section(itemLine(item, today), itemMenu(item.id));

// ── what needs attention ────────────────────────────────────

export function isQuiet(item: OpsItem, now: Date): boolean {
  return !isClosed(item.status) && daysBetween(sastDate(item.last_activity_at), sastDate(now)) >= QUIET_DAYS;
}

export function isPastDate(item: OpsItem, today: string): boolean {
  return !isClosed(item.status) && !!item.due_on && item.due_on < today;
}

/** Open and asking for a look: due by today, past its date, needs more time, or gone quiet. */
export function needsAttention(item: OpsItem, now: Date): boolean {
  if (isClosed(item.status)) return false;
  const today = sastDate(now);
  return (
    (!!item.due_on && item.due_on <= today) ||
    item.status === "more_time" ||
    (item.status === "new" && daysBetween(sastDate(item.created_at), today) >= 2) ||
    isQuiet(item, now)
  );
}

// Slack allows 50 blocks; each list is capped and the rest counted.
const CAP = 12;

function list(title: string, items: OpsItem[], today: string, area: string): Block[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, CAP);
  const out: Block[] = [section(`*${title}* (${items.length})`), ...shown.map((i) => itemBlock(i, today))];
  if (items.length > CAP) out.push(context(`+${items.length - CAP} more — <${areaUrl(area)}|open ${areaLabel(area)} in the Hub>`));
  return out;
}

// ── morning message (per area) ──────────────────────────────

/**
 * @param items  every open item in the area, plus any closed since `since`
 * @param since  when the last morning message went out (or 24h ago)
 * Returns null on a quiet day: nothing new, nothing open, nothing done.
 */
export function morningMessage(area: string, items: OpsItem[], since: Date, now: Date = new Date()): Message | null {
  const today = sastDate(now);
  const sinceIso = since.toISOString();
  const open = items.filter((i) => !isClosed(i.status));
  const fresh = open.filter((i) => i.created_at >= sinceIso);
  const done = items.filter((i) => isClosed(i.status) && i.closed_at && i.closed_at >= sinceIso);
  const freshIds = new Set(fresh.map((i) => i.id));
  const attention = open.filter((i) => !freshIds.has(i.id) && needsAttention(i, now));
  const attentionIds = new Set(attention.map((i) => i.id));
  const rest = open.filter((i) => !freshIds.has(i.id) && !attentionIds.has(i.id));

  if (fresh.length === 0 && open.length === 0 && done.length === 0) return null;

  const label = areaLabel(area);
  const summary = [
    `${fresh.length} new`,
    `${open.length} open`,
    done.length ? `${done.length} done since the last message` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks: Block[] = [
    header(`${label} · ${dayLabel(today)}`),
    context(summary),
    ...list("New", fresh, today, area),
    ...list("Needs a look", attention, today, area),
    ...list("Still open", rest, today, area),
  ];
  if (done.length) {
    blocks.push(divider(), context(`✓ Done: ${done.slice(0, 15).map((i) => esc(i.title)).join(" · ")}${done.length > 15 ? ` +${done.length - 15} more` : ""}`));
  }
  blocks.push(context(`Use ⋯ on any line to mark it done, seen, or needing more time. <${areaUrl(area)}|Open ${label} in the Hub>`));

  return { text: `${label} this morning: ${summary}`, blocks: blocks.slice(0, 50) };
}

// ── personal morning DM ─────────────────────────────────────

export function personalMessage(firstName: string, items: OpsItem[], now: Date = new Date()): Message | null {
  const open = items.filter((i) => !isClosed(i.status));
  if (open.length === 0) return null;
  const today = sastDate(now);
  const sorted = [...open].sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"));
  const shown = sorted.slice(0, 20);
  const blocks: Block[] = [
    section(`Morning ${esc(firstName)} — here ${open.length === 1 ? "is the 1 thing" : `are the ${open.length} things`} with your name on it.`),
    ...shown.map((i) => section(`${itemLine(i, today)} · _${areaLabel(i.area)}_`, itemMenu(i.id))),
  ];
  if (open.length > shown.length) blocks.push(context(`+${open.length - shown.length} more in the Hub`));
  blocks.push(context("If something needs more time, just say so with ⋯ — that's all the meeting needs to know."));
  return { text: `${open.length} operations item${open.length === 1 ? "" : "s"} with your name on it`, blocks };
}

// ── reminders ───────────────────────────────────────────────

export type ReminderKind = "assigned" | "day_before" | "due_day" | "past_due";

/** Which dated reminder (if any) an open item earns today. */
export function reminderFor(item: OpsItem, today: string): Exclude<ReminderKind, "assigned"> | null {
  if (isClosed(item.status) || !item.owner_user_id || !item.due_on) return null;
  const n = daysBetween(today, item.due_on);
  if (n === 1) return "day_before";
  if (n === 0) return "due_day";
  if (n === -1) return "past_due"; // once, the day after — never again
  return null;
}

export function reminderMessage(kind: ReminderKind, item: OpsItem, today: string, givenBy?: string | null): Message {
  const title = esc(item.title);
  const lead: Record<ReminderKind, string> = {
    assigned: `${givenBy ? `${esc(givenBy)} gave you` : "You've been given"} *${title}*${item.due_on ? `, ${dueWords(item.due_on, today)}` : ""}.`,
    day_before: `*${title}* is due tomorrow.`,
    due_day: `*${title}* is due today.`,
    past_due: `*${title}* was due yesterday. If it needs more time, just say so — it'll come up at Wednesday's meeting either way.`,
  };
  return {
    text: lead[kind].replace(/\*/g, ""),
    blocks: [section(lead[kind]), section(itemLine(item, today), itemMenu(item.id))],
  };
}

// ── to whoever asked ────────────────────────────────────────

const REQUESTER_WORDS: Partial<Record<ItemStatus, string>> = {
  seen: "has been seen by the maintenance team",
  in_progress: "is being worked on",
  more_time: "needs more time",
  done: "is done",
  wont_do: "won't be done",
};

export function requesterMessage(item: OpsItem, status: ItemStatus, note: string | null, by: string | null): Message | null {
  const words = REQUESTER_WORDS[status];
  if (!words) return null;
  const where = item.location ? ` (${esc(item.location)})` : "";
  const text = `Your request *${esc(item.title)}*${where} ${words}.`;
  const blocks: Block[] = [section(text)];
  if (note) blocks.push(section(`> ${esc(note).replace(/\n/g, "\n> ")}`));
  if (by) blocks.push(context(`— ${esc(by)}`));
  return { text: text.replace(/\*/g, ""), blocks };
}

// ── the week (for the Wednesday meeting) ────────────────────

export type AreaWeek = {
  area: string;
  done: OpsItem[];
  fresh: OpsItem[];
  open: OpsItem[];
  decide: OpsItem[];
};

/** Needs a decision at the meeting: past its date, needing more time, quiet, or nobody on it after 2 days. */
export function needsDecision(item: OpsItem, now: Date): boolean {
  if (isClosed(item.status)) return false;
  const today = sastDate(now);
  return (
    isPastDate(item, today) ||
    item.status === "more_time" ||
    isQuiet(item, now) ||
    (!item.owner_user_id && item.status === "new" && daysBetween(sastDate(item.created_at), today) >= 2)
  );
}

/** Group items for the week that started at `from` (SAST date). */
export function summariseWeek(items: OpsItem[], from: string, now: Date = new Date()): AreaWeek[] {
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - 2 * 3600_000).toISOString();
  return AREAS.map(({ key }) => {
    const mine = items.filter((i) => i.area === key);
    const open = mine.filter((i) => !isClosed(i.status));
    return {
      area: key,
      done: mine.filter((i) => isClosed(i.status) && i.closed_at && i.closed_at >= start),
      fresh: mine.filter((i) => i.created_at >= start),
      open,
      decide: open.filter((i) => needsDecision(i, now)),
    };
  }).filter((w) => w.done.length || w.fresh.length || w.open.length);
}

export function weeklyMessage(weeks: AreaWeek[], from: string, meetingOn: string, now: Date = new Date()): Message {
  const today = sastDate(now);
  const blocks: Block[] = [
    header(`Operations week · ${dayLabel(from)} – ${dayLabel(today)}`),
    context(`For the meeting on ${dayLabel(meetingOn)} at 10:00. <${weekUrl()}|Open the meeting page>`),
  ];
  if (weeks.length === 0) {
    blocks.push(section("A quiet week: nothing new, nothing open."));
  }
  for (const w of weeks) {
    blocks.push(
      divider(),
      section(`*${areaLabel(w.area)}*\n${w.done.length} done · ${w.fresh.length} new · ${w.open.length} still open`)
    );
    if (w.done.length) {
      blocks.push(context(`✓ ${w.done.slice(0, 12).map((i) => esc(i.title)).join(" · ")}${w.done.length > 12 ? ` +${w.done.length - 12} more` : ""}`));
    }
    if (w.decide.length) {
      const lines = w.decide.slice(0, 8).map((i) => `• ${itemLine(i, today).replace(/\n/, " — ")}`);
      if (w.decide.length > 8) lines.push(`• +${w.decide.length - 8} more on the meeting page`);
      blocks.push(section(`*To talk about*\n${lines.join("\n")}`));
    }
  }
  const totals = weeks.reduce((t, w) => ({ done: t.done + w.done.length, fresh: t.fresh + w.fresh.length, open: t.open + w.open.length }), { done: 0, fresh: 0, open: 0 });
  return {
    text: `Operations this week: ${totals.done} done, ${totals.fresh} new, ${totals.open} still open`,
    blocks: blocks.slice(0, 50),
  };
}

/** After the meeting: what was handed to whom, by when. */
export function recapMessage(items: OpsItem[], meetingOn: string): Message {
  const today = meetingOn;
  const lines = items.map((i) => `• *${esc(i.title)}* — ${esc(i.owner_name ?? "nobody yet")}${i.due_on ? `, ${dueWords(i.due_on, today)}` : ""} · _${areaLabel(i.area)}_`);
  return {
    text: `Operations meeting ${dayLabel(meetingOn)}: ${items.length} task${items.length === 1 ? "" : "s"} handed out`,
    blocks: [
      header(`Operations meeting · ${dayLabel(meetingOn)}`),
      section(items.length ? `*Handed out*\n${lines.join("\n")}` : "No new tasks handed out."),
      context(`Everyone with a task gets a reminder the day before it's due. <${weekUrl()}|Meeting page>`),
    ],
  };
}
