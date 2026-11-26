// The 07:00 Fleet reminder (SPEC 6.11): build it with the tested rules, then email it to
// whoever holds the Vehicle Coordinator role. On Slack it is part of the vehicle team's
// 07:00 digest (lib/vehicles/slack-alerts.ts), so people get one Slack message, not two
// (Jack, 18 Nov 2026). Replaces the claude.ai scheduled task "FFSA vehicle inspection reminders".
//
// Sending is OFF everywhere except the live site (VERCEL_ENV=production and preview
// writes not disabled), so local runs, Vercel previews (which share the production
// database) and tests can never message anyone. Everywhere else this only builds the
// message, which is what the admin preview page shows.

import { previewWritesDisabled } from "@/lib/preview-writes";
import { bodyParagraph, emphasis, escapeHtml, renderEmailShell } from "@/lib/email/shell";
import { sendTransactional } from "@/lib/email/send-transactional";
import * as slack from "@/lib/slack/client";
import { isBotConfigured } from "@/lib/slack/bots";
import { loadFleet, type Coordinator } from "./load";
import { REMINDER_SECTIONS, buildReminder, todayInSA, type FleetData, type ISODate, type Reminder } from "./rules";
import { buildFleetDigest, fleetBookingParts, fleetDigestCount, fleetVehicleParts } from "./digest";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Fleet sends nothing (no email, nothing in the Slack digest) until it is switched on
 * on purpose: FLEET_MESSAGES_ENABLED=1, and only on the live site. Gideon wants to
 * revisit the messages before they go out (18 Nov 2026). Off, it only builds the message,
 * which the admin preview page shows.
 */
export function canSendFleetReminder(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FLEET_MESSAGES_ENABLED !== "1" && env.FLEET_MESSAGES_ENABLED !== "true") return false;
  return env.VERCEL_ENV === "production" && !previewWritesDisabled(env);
}

/** Fleet → Today on the Hub. */
export function fleetTodayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com").replace(/\/+$/, "");
  return `${base}/bookings/vehicles/fleet`;
}

// ── The message in each channel ────────────────────────────

export function reminderEmailHtml(r: Reminder, url: string): string {
  const sections = REMINDER_SECTIONS.filter(([k]) => r.sections[k].length)
    .map(
      ([k, title]) =>
        bodyParagraph(emphasis(escapeHtml(title))) +
        `<ul style="margin:0 0 16px 18px;padding:0">${r.sections[k].map((l) => `<li style="margin:0 0 6px 0">${escapeHtml(l)}</li>`).join("")}</ul>`
    )
    .join("");
  return renderEmailShell({
    title: r.subject,
    preheader: r.subject,
    eyebrow: "FFSA Fleet",
    heading: "Today’s vehicle checks",
    bodyHtml: sections,
    cta: { label: "Open Fleet", url },
    siteUrl: url.replace(/\/bookings\/vehicles\/fleet$/, ""),
  });
}

/** Slack mrkdwn: bold subject, then each section as a bulleted list, then the link. */
export function reminderSlackText(r: Reminder, url: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = REMINDER_SECTIONS.filter(([k]) => r.sections[k].length)
    .map(([k, title]) => `*${title}*\n${r.sections[k].map((l) => "• " + esc(l)).join("\n")}`)
    .join("\n\n");
  return `*${esc(r.subject)}*\n\n${body}\n\n<${url}|Open Fleet>`;
}

// ── Sending ────────────────────────────────────────────────

export type ChannelResult = "ok" | "off" | "missing" | "error";
export interface RecipientResult {
  name: string;
  email: ChannelResult;
  slack: ChannelResult;
  errors?: string[];
}

export interface ReminderDeps {
  sendEmail: (to: string, subject: string, html: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  sendSlackDm: (slackUserId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  slackReady: () => boolean;
}

export const realDeps: ReminderDeps = {
  async sendEmail(to, subject, html, text) {
    const r = await sendTransactional({
      to,
      subject,
      html,
      text,
      category: "fleet_reminder",
      fromName: "FFSA Fleet",
      reason: "You hold the Vehicle Coordinator role: this is Fleet's daily 07:00 reminder.",
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
  async sendSlackDm(slackUserId, text) {
    const conv = await slack.openConversation(slackUserId, "hub");
    const channel = conv.ok ? (conv as { channel?: { id: string } }).channel?.id : undefined;
    if (!channel) return { ok: false, error: (conv as { error?: string }).error || "no DM channel" };
    const sent = await slack.postMessage({ channel, text, bot: "hub" });
    return sent.ok ? { ok: true } : { ok: false, error: (sent as { error?: string }).error || "post failed" };
  },
  slackReady: () => isBotConfigured("hub"),
};

/** Deliver one reminder to each co-ordinator by the channels switched on in settings. */
export async function deliverReminder(
  r: Reminder,
  url: string,
  coordinators: Coordinator[],
  notify: { email?: unknown; slack?: unknown },
  deps: ReminderDeps
): Promise<RecipientResult[]> {
  const emailOn = notify.email !== false;
  const slackOn = notify.slack !== false;
  const html = reminderEmailHtml(r, url);
  const slackText = reminderSlackText(r, url);
  const out: RecipientResult[] = [];
  for (const c of coordinators) {
    const res: RecipientResult = { name: c.name, email: "off", slack: "off" };
    const errors: string[] = [];
    if (emailOn) {
      if (!c.email) res.email = "missing";
      else {
        const e = await deps.sendEmail(c.email, r.subject, html, r.text).catch((err) => ({ ok: false, error: String(err?.message || err) }));
        res.email = e.ok ? "ok" : "error";
        if (!e.ok && e.error) errors.push("email: " + e.error);
      }
    }
    if (slackOn) {
      if (!c.slackUserId || !deps.slackReady()) res.slack = "missing";
      else {
        const s = await deps.sendSlackDm(c.slackUserId, slackText).catch((err) => ({ ok: false, error: String(err?.message || err) }));
        res.slack = s.ok ? "ok" : "error";
        if (!s.ok && s.error) errors.push("slack: " + s.error);
      }
    }
    if (errors.length) res.errors = errors;
    out.push(res);
  }
  return out;
}

export interface ReminderRun {
  date: ISODate;
  /** The fleet as the rules saw it (the 07:00 message sorts it by vehicle). */
  F: FleetData;
  reminder: Reminder;
  url: string;
  coordinators: Coordinator[];
  notify: { email: boolean; slack: boolean };
  /** What happened: preview only, nothing to say, already sent today, no one to send to, or sent. */
  outcome: "preview" | "empty" | "already-sent" | "no-coordinator" | "sent";
  results?: RecipientResult[];
}

/**
 * Build the reminder for `date` (default: today in South Africa) and, when `send` is
 * true and there's something to say, deliver it once. `admin` is the service-role client.
 */
export async function runFleetReminder(
  admin: Client,
  opts: { date?: ISODate; send: boolean; deps?: ReminderDeps; url?: string }
): Promise<ReminderRun> {
  const date = opts.date || todayInSA();
  const url = opts.url || fleetTodayUrl();
  const { F, coordinators } = await loadFleet(admin, date);
  const reminder = buildReminder(F, date, { appUrl: url, linkText: "Open Fleet" });
  const n = (F.notify || {}) as { email?: unknown; slack?: unknown };
  const notify = { email: n.email !== false, slack: n.slack !== false };
  const base = { date, F, reminder, url, coordinators, notify };

  if (reminder.empty) return { ...base, outcome: "empty" };
  if (!opts.send) return { ...base, outcome: "preview" };
  if (!coordinators.length) return { ...base, outcome: "no-coordinator" };

  // Claim the day first, so a retried or doubled cron can't send twice.
  const claim = await admin.from("fleet_reminder_sends").insert({ date, subject: reminder.subject, recipients: [] });
  if (claim.error) {
    if (claim.error.code === "23505") return { ...base, outcome: "already-sent" };
    throw new Error(claim.error.message);
  }
  // Email only: Slack carries the same sections inside the vehicle digest (fleetDigestPart).
  const results = await deliverReminder(reminder, url, coordinators, { ...n, slack: false }, opts.deps || realDeps);
  await admin.from("fleet_reminder_sends").update({ recipients: results }).eq("date", date);
  return { ...base, outcome: "sent", results };
}

export interface FleetDigestPart {
  outcome: ReminderRun["outcome"];
  /** Blocks for the Bookings part: clashes and today's pre- and post-rental inspections. */
  bookingParts: string[];
  /** Blocks for the Fleet part: every vehicle, IN or OUT. Empty when Fleet's messages are off. */
  fleetParts: string[];
  items: number;
  /** The coordinators' Slack ids, so they get the digest even if not on its alert list. */
  slackUserIds: string[];
}

/** Both Fleet parts of the 07:00 message for this run (what the preview page shows too). */
export function fleetDigestBlocks(run: Pick<ReminderRun, "F" | "date" | "url">) {
  const d = buildFleetDigest(run.F, run.date);
  return {
    // One calendar (Fleet 5d): clashes are sorted out on the booking board.
    bookingParts: fleetBookingParts(d, run.url.replace(/\/fleet$/, "/board")),
    fleetParts: [`*🔧 FLEET – <${run.url}|open Fleet>*`, ...fleetVehicleParts(d)],
    items: fleetDigestCount(d),
  };
}

/**
 * Run at 07:00 by the vehicle digest cron: emails the reminder (once a day, live site only)
 * and returns Fleet's blocks for the single Slack message from the FFSA Hub Activity bot.
 * Off (FLEET_MESSAGES_ENABLED unset, or not the live site) it returns no blocks, so
 * previews and local runs never put Fleet into a Slack message.
 */
export async function fleetDigestPart(
  admin: Client,
  opts: { date?: ISODate; deps?: ReminderDeps; env?: NodeJS.ProcessEnv } = {}
): Promise<FleetDigestPart> {
  const send = canSendFleetReminder(opts.env);
  const run = await runFleetReminder(admin, { date: opts.date, send, deps: opts.deps });
  const on = send && run.notify.slack && run.F.vehicles.length > 0;
  const b = on ? fleetDigestBlocks(run) : { bookingParts: [], fleetParts: [], items: 0 };
  return {
    outcome: run.outcome,
    ...b,
    slackUserIds: on ? run.coordinators.map((c) => c.slackUserId).filter((x): x is string => !!x) : [],
  };
}
