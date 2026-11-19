// Legal → Documents — what the 07:00 reminder says, and when. Pure: the
// cron (/api/cron/legal-reminders), the preview and the dashboard card all
// build from here, so they never disagree. Plan: docs/legal-documents.md.
//
// Colour scale (Gideon, 18 Nov 2026): green at 90 days, yellow at 60,
// orange at 30, red at 7 and after. Applications use the same four colours
// on a shorter scale: 21 / 14 / 7 / 2 days before lodge-by.
//
// When something is mentioned (a "milestone"):
//   * Documents: 90, 60, 30 and 7 days before expiry, and on the day.
//     Once a renewal is under way (an open application for the document,
//     or status "applying") the 90/60/30 reminders are skipped — someone
//     is already on it — and only 7 days and the day itself still come up.
//   * Expired documents: every Monday, Wednesday and Friday until dealt with.
//   * Applications not yet lodged: 21, 14, 7 and 2 days before lodge-by,
//     and on the day; once late, every Monday, Wednesday and Friday.
//   * Applications lodged and past their expected date: every Monday
//     (it is waiting on someone else).
//   * A day with milestones: those, then everything else still open.
//   * A day with no milestone (a "quiet day"): the next 5 things coming up
//     — only on quiet days — and on a quiet Monday everything still open.
// Nothing is sent when there is nothing open and nothing coming up.

import {
  applicationState,
  daysBetween,
  describeDays,
  documentState,
  isApplicationOpen,
} from "./status";

export const DOCUMENT_MILESTONES = [90, 60, 30, 7, 0];
export const APPLICATION_MILESTONES = [21, 14, 7, 2, 0];
export const UPCOMING_COUNT = 5;

// ────────────────────────────────────────────────────────────
// COLOUR SCALE
// ────────────────────────────────────────────────────────────

export type Urgency = "green" | "yellow" | "orange" | "red";

/** Days until a document expires → its colour. More than 90 days: none. */
export function documentUrgency(daysLeft: number | null): Urgency | null {
  if (daysLeft === null) return null;
  if (daysLeft <= 7) return "red";
  if (daysLeft <= 30) return "orange";
  if (daysLeft <= 60) return "yellow";
  if (daysLeft <= 90) return "green";
  return null;
}

/** Days until an application's lodge-by date → its colour. */
export function lodgeUrgency(days: number | null): Urgency | null {
  if (days === null) return null;
  if (days <= 2) return "red";
  if (days <= 7) return "orange";
  if (days <= 14) return "yellow";
  if (days <= 21) return "green";
  return null;
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  green: "90 days",
  yellow: "60 days",
  orange: "30 days",
  red: "7 days or less",
};

/** Hex colours, shared by the email and the Hub. Text colour for each. */
export const URGENCY_COLOUR: Record<Urgency, { bg: string; fg: string }> = {
  green: { bg: "#3E7F2B", fg: "#FFFFFF" },
  yellow: { bg: "#FFB801", fg: "#0A0A0A" },
  orange: { bg: "#D9480F", fg: "#FFFFFF" },
  red: { bg: "#B42318", fg: "#FFFFFF" },
};

// ────────────────────────────────────────────────────────────
// SHAPES
// ────────────────────────────────────────────────────────────

export type ReminderDoc = {
  id: string;
  title: string;
  folder_id: string;
  type_id: string | null;
  expires_on: string | null;
  renew_lead_days: number | null;
  status: string;
  superseded_by: string | null;
};
export type ReminderApp = {
  id: string;
  title: string;
  folder_id: string;
  document_id: string | null;
  status: string;
  lodge_by: string | null;
  submitted_on: string | null;
  expected_on: string | null;
};

export type ReminderLine = {
  kind: "document" | "application";
  id: string;
  title: string;
  folder: string;
  /** Plain words: "30 days left (18 Dec)", "Expired 14 days ago", "Lodge by 2 Dec". */
  when: string;
  /** Colour on the 90/60/30/7 scale; null = further out than the scale. */
  urgency: Urgency | null;
  /** Sort key: days until the date that matters (negative = past). */
  days: number;
};

export type Reminder = {
  /** Lines that hit a milestone today. */
  today: ReminderLine[];
  /** Everything else still needing someone (Monday list, dashboard). */
  open: ReminderLine[];
  /** The next dated things, soonest first, not already above (quiet days). */
  upcoming: ReminderLine[];
  counts: { expired: number; renewNow: number; missing: number; applicationsPressing: number };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (ymd: string) => {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

/** 0 = Sunday … 6 = Saturday, from a YYYY-MM-DD date. */
export function weekday(today: string): number {
  return new Date(`${today}T12:00:00Z`).getUTCDay();
}
export const isMonday = (today: string) => weekday(today) === 1;
/** The days overdue things come up: Monday, Wednesday, Friday. */
export const isOverdueDay = (today: string) => [1, 3, 5].includes(weekday(today));

// ────────────────────────────────────────────────────────────
// BUILD
// ────────────────────────────────────────────────────────────

export function buildReminder(args: {
  today: string;
  documents: ReminderDoc[];
  applications: ReminderApp[];
  typeLeadDays: Map<string, number>;
  folderNames: Map<string, string>;
}): Reminder {
  const { today, documents, applications, typeLeadDays, folderNames } = args;
  const openFor = new Set(applications.filter((a) => isApplicationOpen(a.status) && a.document_id).map((a) => a.document_id));
  const overdueDay = isOverdueDay(today);
  const todayLines: ReminderLine[] = [];
  const open: ReminderLine[] = [];
  const future: ReminderLine[] = [];
  const counts = { expired: 0, renewNow: 0, missing: 0, applicationsPressing: 0 };

  for (const d of documents) {
    const s = documentState(
      { ...d, type_lead_days: d.type_id ? typeLeadDays.get(d.type_id) ?? null : null, has_open_application: openFor.has(d.id) },
      today
    );
    if (s.state === "inactive") continue;
    if (s.state === "expired") counts.expired++;
    if (s.state === "expiring") counts.renewNow++;
    if (s.state === "missing") counts.missing++;

    const line: ReminderLine = {
      kind: "document",
      id: d.id,
      title: d.title,
      folder: folderNames.get(d.folder_id) ?? "",
      when:
        s.state === "missing"
          ? "Not held yet"
          : `${describeDays(s.daysLeft)}${s.state === "in_hand" ? " · renewal under way" : ""}${d.expires_on ? ` (${shortDate(d.expires_on)})` : ""}`,
      urgency: documentUrgency(s.daysLeft),
      days: s.daysLeft ?? 9999,
    };

    const underway = s.state === "in_hand";
    const hit =
      s.daysLeft !== null &&
      (s.daysLeft < 0
        ? overdueDay
        : underway
          ? s.daysLeft === 7 || s.daysLeft === 0
          : DOCUMENT_MILESTONES.includes(s.daysLeft));

    if (hit) todayLines.push(line);
    else if (s.state === "expired" || s.state === "expiring" || s.state === "missing") open.push(line);
    else if (s.daysLeft !== null && s.daysLeft > 0) future.push(line);
  }

  for (const a of applications) {
    const st = applicationState(a, today);
    if (st === "closed") continue;
    const lodged = !["planned", "gathering"].includes(a.status);
    const pressing = st === "late" || st === "due_soon" || st === "overdue";
    if (pressing) counts.applicationsPressing++;

    let hit = false;
    let when = "";
    let days = 9999;
    let urgency: Urgency | null = null;
    if (!lodged && a.lodge_by) {
      days = daysBetween(today, a.lodge_by);
      urgency = lodgeUrgency(days);
      hit = days < 0 ? overdueDay : APPLICATION_MILESTONES.includes(days);
      when =
        days < 0
          ? `Lodge-by passed ${-days} ${-days === 1 ? "day" : "days"} ago (${shortDate(a.lodge_by)})`
          : days === 0
            ? "Lodge today"
            : `Lodge by ${shortDate(a.lodge_by)} · ${days} ${days === 1 ? "day" : "days"} left`;
    } else if (lodged && a.expected_on) {
      days = daysBetween(today, a.expected_on);
      urgency = days < 0 ? "red" : null;
      hit = days < 0 && isMonday(today);
      when = days < 0 ? `Expected back ${shortDate(a.expected_on)}, not heard yet` : `Expected back ${shortDate(a.expected_on)}`;
    } else {
      continue; // no date to remind about
    }

    const line: ReminderLine = {
      kind: "application",
      id: a.id,
      title: a.title,
      folder: folderNames.get(a.folder_id) ?? "",
      when,
      urgency,
      days,
    };
    if (hit) todayLines.push(line);
    else if (pressing) open.push(line);
    else if (days > 0) future.push(line);
  }

  const byDays = (x: ReminderLine, y: ReminderLine) => x.days - y.days || x.title.localeCompare(y.title);
  // "Coming up": the next dated things, soonest first. Overdue and undated
  // ones are left out (they are in the open list); today's are already above.
  const upcoming = [...open, ...future]
    .filter((l) => l.days > 0 && l.days !== 9999)
    .sort(byDays)
    .slice(0, UPCOMING_COUNT);

  return { today: todayLines.sort(byDays), open: open.sort(byDays), upcoming, counts };
}

/** A day with no milestone. */
export const isQuietDay = (r: Reminder) => r.today.length === 0;

/** Whether today's email goes out at all. */
export function shouldSend(r: Reminder, today: string): boolean {
  if (r.today.length > 0) return true;
  // Quiet day: the next five coming up, and on Mondays everything open.
  return r.upcoming.length > 0 || (isMonday(today) && r.open.length > 0);
}

export function reminderSubject(r: Reminder, today: string): string {
  const n = r.today.length;
  if (n > 0) return `Legal papers: ${n} ${n === 1 ? "thing needs" : "things need"} you today`;
  if (isMonday(today) && r.open.length > 0) return `Legal papers: ${r.open.length} still open this week`;
  const next = r.upcoming[0];
  return next ? `Legal papers: nothing due today · next up in ${next.days} ${next.days === 1 ? "day" : "days"}` : "Legal papers";
}

// ────────────────────────────────────────────────────────────
// EMAIL — titles and dates only: no reference numbers, holders or notes
// ────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function chip(u: Urgency | null): string {
  if (!u) return "";
  const c = URGENCY_COLOUR[u];
  return `<span style="display:inline-block;width:10px;height:10px;background:${c.bg};margin-right:8px;vertical-align:middle;"></span>`;
}

function linesHtml(lines: ReminderLine[], link: string): string {
  return lines
    .map((l) => {
      const c = l.urgency ? URGENCY_COLOUR[l.urgency] : null;
      return `<tr>
  <td style="padding:10px 0;border-bottom:1px solid #E7E4D9;${c ? `border-left:4px solid ${c.bg};padding-left:10px;` : ""}">
    <a href="${esc(link)}" style="color:#0A0A0A;font-weight:600;text-decoration:none;">${esc(l.title)}</a>
    <div style="font-size:12px;color:#7C786C;">${esc(l.folder)}${l.kind === "application" ? " · application" : ""}</div>
  </td>
  <td style="padding:10px 0 10px 12px;border-bottom:1px solid #E7E4D9;text-align:right;font-size:13px;color:#0A0A0A;white-space:nowrap;">${chip(l.urgency)}${esc(l.when)}</td>
</tr>`;
    })
    .join("\n");
}

function legendHtml(): string {
  return (Object.keys(URGENCY_COLOUR) as Urgency[])
    .map((u) => `<span style="margin-right:14px;white-space:nowrap;">${chip(u)}${esc(URGENCY_LABEL[u])}</span>`)
    .join("");
}

export function reminderEmail(r: Reminder, today: string, appUrl: string): { subject: string; html: string; text: string } {
  const link = `${appUrl.replace(/\/$/, "")}/legal-documents`;
  const subject = reminderSubject(r, today);
  const quiet = isQuietDay(r);
  const monday = isMonday(today);
  const section = (title: string, lines: ReminderLine[]) =>
    lines.length
      ? `<h2 style="font:900 16px/1.2 'Roboto Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:0.04em;margin:24px 0 4px;">${esc(title)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:14px/1.4 Roboto,Arial,sans-serif;">${linesHtml(lines, link)}</table>`
      : "";
  // A busy day: today, then everything else still open.
  // A quiet day: on Mondays everything open, then (only then) the next five.
  const showOpen = !quiet || monday;
  const openTitle = quiet ? "Still open" : "Also still open";
  const html = `<!doctype html><html><body style="margin:0;background:#F4F2EA;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #DEDACE;padding:24px;font:14px/1.5 Roboto,Arial,sans-serif;color:#0A0A0A;">
  <div style="font:700 10px/1 'Roboto Mono',monospace;letter-spacing:0.2em;text-transform:uppercase;color:#55524A;">Legal · Documents</div>
  <h1 style="font:900 28px/1 'Roboto Condensed',Arial,sans-serif;text-transform:uppercase;margin:8px 0 0;">${esc(subject.replace(/^Legal papers: /, ""))}</h1>
  ${section("Today", r.today)}
  ${showOpen ? section(openTitle, r.open) : ""}
  ${quiet ? section("Coming up next", r.upcoming) : ""}
  <p style="margin:20px 0 0;font-size:12px;color:#55524A;">${legendHtml()}</p>
  <p style="margin:24px 0 0;"><a href="${esc(link)}" style="display:inline-block;background:#0A0A0A;color:#FFFFFF;padding:12px 16px;font:700 11px/1 'Roboto Mono',monospace;letter-spacing:0.14em;text-transform:uppercase;text-decoration:none;">Open Documents</a></p>
  <p style="margin:20px 0 0;font-size:12px;color:#7C786C;">You get this because you look after FFSA's legal papers in the Hub. Reminders come at 90, 60, 30 and 7 days before something runs out and on the day; expired papers every Monday, Wednesday and Friday.</p>
</div></body></html>`;
  const textLines = (lines: ReminderLine[]) => lines.map((l) => `- ${l.title} (${l.folder}): ${l.when}`).join("\n");
  const text = [
    subject,
    r.today.length ? `\nToday:\n${textLines(r.today)}` : "",
    showOpen && r.open.length ? `\n${openTitle}:\n${textLines(r.open)}` : "",
    quiet && r.upcoming.length ? `\nComing up next:\n${textLines(r.upcoming)}` : "",
    `\nOpen Documents: ${link}`,
  ].join("\n");
  return { subject, html, text };
}
