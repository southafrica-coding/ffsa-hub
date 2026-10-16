// ────────────────────────────────────────────────────────────
// FFSA Hub — an event's own wording on its emails (migration 242)
// ────────────────────────────────────────────────────────────
// Per event, per email: a subject line and/or a message of its own. The
// message sits inside the email's normal design, after its standard opening
// and before the tickets / amount — so the QR codes, totals and links every
// email needs are never lost to an edit. Merge tags fill per recipient.
//
// Stored on events.email_wording as { [key]: { subject?, message? } }.
// Pure, so the rules are tested directly.
// ────────────────────────────────────────────────────────────

export const EVENT_EMAILS = {
  ticket_confirmation: { name: "Ticket confirmation", message: true },
  pay_later_invoice: { name: "Pay-later invoice", message: true },
  refund: { name: "Refund", message: true },
  cancellation_notice: { name: "Cancellation notice", message: false },
  feedback_invite: { name: "Feedback invite", message: true },
  feedback_reminder: { name: "Feedback reminder", message: true },
} as const;

export type EventEmailKey = keyof typeof EVENT_EMAILS;
export type EmailWording = { subject?: string | null; message?: string | null };
export type EventEmailWording = Partial<Record<EventEmailKey, EmailWording>>;

export const MERGE_TAGS = ["[First Name]", "[Event]"] as const;

export const SUBJECT_MAX = 160;
export const MESSAGE_MAX = 2000;

/** Fill [First Name] and [Event] (any case). A missing first name reads "there". */
export function fillTags(text: string, vars: { firstName?: string | null; eventTitle: string }): string {
  return text
    .replace(/\[first name\]/gi, vars.firstName?.trim() || "there")
    .replace(/\[event\]/gi, vars.eventTitle);
}

/** Anything in square brackets that isn't a merge tag we fill. */
export function unknownTags(text: string): string[] {
  const known = new Set(MERGE_TAGS.map((t) => t.toLowerCase()));
  return [...new Set((text.match(/\[[^\]\n]{1,40}\]/g) ?? []).filter((t) => !known.has(t.toLowerCase())))];
}

/** Clean what staff typed, or null when there's nothing left. */
export function cleanWording(raw: unknown): EventEmailWording {
  const out: EventEmailWording = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(EVENT_EMAILS) as EventEmailKey[]) {
    const w = (raw as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    if (!w || typeof w !== "object") continue;
    const subject = typeof w.subject === "string" ? w.subject.replace(/\s+/g, " ").trim().slice(0, SUBJECT_MAX) : "";
    const message =
      EVENT_EMAILS[key].message && typeof w.message === "string"
        ? w.message.replace(/\r\n/g, "\n").trim().slice(0, MESSAGE_MAX)
        : "";
    if (subject || message) out[key] = { ...(subject ? { subject } : {}), ...(message ? { message } : {}) };
  }
  return out;
}

/**
 * The subject and message for one email: the event's own when it set one,
 * else the standard subject and no extra message.
 */
export function wordingFor(
  stored: unknown,
  key: EventEmailKey,
  vars: { firstName?: string | null; eventTitle: string; defaultSubject: string }
): { subject: string; message: string | null } {
  const w = cleanWording(stored)[key];
  return {
    subject: w?.subject ? fillTags(w.subject, vars) : vars.defaultSubject,
    message: w?.message ? fillTags(w.message, vars) : null,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The event's message as email HTML, in the colours and type of the email
 * it sits in. Paragraphs on blank lines, line breaks kept, links left as
 * text (email clients make them clickable).
 */
export function eventMessageHtml(message: string | null | undefined, style: { color: string; font: string }): string {
  if (!message?.trim()) return "";
  return message
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-family:${style.font};font-size:14px;line-height:1.65;color:${style.color};">${esc(p).replace(/\n/g, "<br />")}</p>`
    )
    .join("");
}
