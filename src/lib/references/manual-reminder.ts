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

/**
 * Whether this reference may be reminded right now.
 * Preview is first: the caller must not email or write reminder_sent_at.
 * Submitted is a conflict. A stamp inside 24 hours is a cooldown.
 * The stamp is reference_requests.reminder_sent_at, which the daily
 * cron writes too, so a manual send and an automatic send share the window.
 */
export function gateManualReminder(input: {
  status: string;
  reminderSentAt: string | null | undefined;
  now?: Date;
  preview: boolean;
}): ReminderGate {
  if (input.preview) {
    return {
      ok: false,
      status: 409,
      error:
        "This is a preview deployment. The reminder was not sent, and the last-reminder time was not changed.",
    };
  }

  if (input.status === "submitted") {
    return {
      ok: false,
      status: 409,
      error: "This reference has already been submitted.",
    };
  }

  const now = input.now ?? new Date();
  if (input.reminderSentAt) {
    const sent = new Date(input.reminderSentAt).getTime();
    if (!Number.isNaN(sent)) {
      const elapsed = now.getTime() - sent;
      if (elapsed < REMINDER_COOLDOWN_MS) {
        const retryMs = REMINDER_COOLDOWN_MS - elapsed;
        return {
          ok: false,
          status: 429,
          error: `A reminder was sent recently. You can send another in ${waitPhrase(retryMs)}.`,
          retryAfterSeconds: Math.ceil(retryMs / 1000),
          nextAllowedAt: new Date(sent + REMINDER_COOLDOWN_MS).toISOString(),
        };
      }
    }
  }

  return { ok: true };
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
