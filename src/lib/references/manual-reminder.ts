import { formatRelativeTime } from "@/lib/users/lifecycle";

/** One reminder per reference in this window, manual or automatic. */
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type ReminderGate =
  | { ok: true }
  | {
      ok: false;
      status: 409 | 429;
      error: string;
      retryAfterSeconds?: number;
      nextAllowedAt?: string;
    };

function waitPhrase(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export type CooldownDetails = {
  error: string;
  retryAfterSeconds: number;
  nextAllowedAt: string;
};

/** How long a stamp still blocks another reminder, or null when the window has passed. */
export function cooldownDetails(
  sentAt: string | null | undefined,
  now = new Date()
): CooldownDetails | null {
  if (!sentAt) return null;
  const sent = new Date(sentAt).getTime();
  if (Number.isNaN(sent)) return null;
  const elapsed = now.getTime() - sent;
  if (elapsed >= REMINDER_COOLDOWN_MS) return null;
  const retryMs = REMINDER_COOLDOWN_MS - elapsed;
  return {
    error: `A reminder was sent recently. You can send another in ${waitPhrase(retryMs)}.`,
    retryAfterSeconds: Math.ceil(retryMs / 1000),
    nextAllowedAt: new Date(sent + REMINDER_COOLDOWN_MS).toISOString(),
  };
}

/**
 * Whether this reference may be reminded right now.
 * Submitted is a conflict. A stamp inside 24 hours is a cooldown.
 * Preview is not decided here: the route returns 403 preview_writes_disabled
 * before it claims a row.
 */
export function gateManualReminder(input: {
  status: string;
  reminderSentAt: string | null | undefined;
  now?: Date;
}): ReminderGate {
  if (input.status === "submitted") {
    return {
      ok: false,
      status: 409,
      error: "This reference has already been submitted.",
    };
  }

  const now = input.now ?? new Date();
  const cooled = cooldownDetails(input.reminderSentAt, now);
  if (cooled) {
    return {
      ok: false,
      status: 429,
      error: cooled.error,
      retryAfterSeconds: cooled.retryAfterSeconds,
      nextAllowedAt: cooled.nextAllowedAt,
    };
  }

  return { ok: true };
}

export type RemindAllResult = {
  id?: string;
  outcome: string;
  error?: string;
};

/** Toast copy for Remind all, including why nothing went out. */
export function remindAllToast(results: RemindAllResult[]): { tone: "ok" | "error"; text: string } {
  const sent = results.filter((row) => row.outcome === "sent").length;
  const cooled = results.filter((row) => row.outcome === "cooldown");
  const finished = results.filter((row) => row.outcome === "not_outstanding");
  const errors = results.filter((row) => row.outcome === "error" || row.outcome === "disabled");

  if (sent > 0 && cooled.length === 0 && errors.length === 0) {
    return { tone: "ok", text: sent === 1 ? "Reminder sent" : `Sent ${sent} reminders` };
  }
  if (sent > 0) {
    const held = cooled.length + errors.length;
    return {
      tone: "ok",
      text: `Sent ${sent} reminder${sent === 1 ? "" : "s"}. ${held} ${held === 1 ? "was" : "were"} not sent.`,
    };
  }
  if (results.length === 0 || (finished.length > 0 && cooled.length === 0 && errors.length === 0)) {
    return {
      tone: "error",
      text: "No reminders were sent. Every reference has already been submitted.",
    };
  }
  if (cooled.length > 0 && errors.length === 0) {
    return {
      tone: "error",
      text: `No reminders were sent. ${cooled[0].error || "They were reminded in the last 24 hours."}`,
    };
  }
  const reason = errors[0]?.error || cooled[0]?.error || "Something went wrong.";
  return { tone: "error", text: `No reminders were sent. ${reason}` };
}

/** "Last reminder sent 3 hours ago", or null when nothing has been sent. */
export function lastReminderLabel(
  sentAt: string | null | undefined,
  nowMs?: number
): string | null {
  if (!sentAt) return null;
  const then = new Date(sentAt).getTime();
  if (Number.isNaN(then)) return null;
  return `Last reminder sent ${formatRelativeTime(sentAt, nowMs)}`;
}
