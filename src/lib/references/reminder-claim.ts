import { referenceSendConfirmed } from "@/lib/email/reference-email";
import { REMINDER_COOLDOWN_MS, cooldownDetails } from "./manual-reminder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ReminderSendResult =
  | { ok: true; id?: string | null }
  | { ok: false; error: string; suppressed?: boolean };

export type ReminderAttempt =
  | { outcome: "sent"; reminderSentAt: string }
  | {
      outcome: "cooldown";
      error: string;
      retryAfterSeconds: number;
      nextAllowedAt: string;
    }
  | { outcome: "not_outstanding" }
  | { outcome: "disabled" }
  | { outcome: "suppressed"; error: string }
  | { outcome: "error"; error: string };

/**
 * PostgREST `or` filter for the claim.
 * The timestamp is quoted so the dot in the milliseconds is not a new operator.
 * Outstanding only: the update also filters `.neq("status", "submitted")`.
 */
export function reminderClaimOrFilter(now: Date): string {
  const cutoff = new Date(now.getTime() - REMINDER_COOLDOWN_MS).toISOString();
  return `reminder_sent_at.is.null,reminder_sent_at.lt."${cutoff}"`;
}

/**
 * Put the previous stamp back only if this claim still owns the row.
 * A later claim that changed reminder_sent_at is left alone.
 */
async function restoreClaim(
  admin: Client,
  refId: string,
  claimedAt: string,
  previous: string | null
): Promise<{ error?: string }> {
  const { error } = await admin
    .from("reference_requests")
    .update({ reminder_sent_at: previous })
    .eq("id", refId)
    .eq("reminder_sent_at", claimedAt)
    .select("id");
  if (error) return { error: error.message || "Could not restore the reminder time." };
  return {};
}

/**
 * Claim reminder_sent_at, then send. Two callers cannot both pass the claim.
 * A failed send rolls the stamp back with compare-and-set. A claim error
 * is returned and nothing is sent.
 *
 * A suppressed address can keep the claim (`keepStampOnSuppressed`) so the
 * nightly job does not retry a bad address. Every other failed send restores
 * the previous stamp.
 */
export async function claimThenSendReferenceReminder(input: {
  admin: Client;
  refId: string;
  status: string;
  previousSentAt: string | null | undefined;
  now?: Date;
  keepStampOnSuppressed?: boolean;
  send: () => Promise<ReminderSendResult>;
}): Promise<ReminderAttempt> {
  if (input.status === "submitted") return { outcome: "not_outstanding" };

  const now = input.now ?? new Date();
  const claimedAt = now.toISOString();
  const claimed = await input.admin
    .from("reference_requests")
    .update({ reminder_sent_at: claimedAt })
    .eq("id", input.refId)
    .neq("status", "submitted")
    .or(reminderClaimOrFilter(now))
    .select("id");

  if (claimed?.error) {
    return {
      outcome: "error",
      error: claimed.error.message || "Could not claim this reminder.",
    };
  }

  const rows = Array.isArray(claimed?.data) ? claimed.data : claimed?.data ? [claimed.data] : [];
  if (rows.length === 0) {
    const cooled = cooldownDetails(input.previousSentAt ?? null, now);
    if (cooled) {
      return {
        outcome: "cooldown",
        error: cooled.error,
        retryAfterSeconds: cooled.retryAfterSeconds,
        nextAllowedAt: cooled.nextAllowedAt,
      };
    }
    return {
      outcome: "cooldown",
      error: "A reminder was sent recently. You can send another in 24 hours.",
      retryAfterSeconds: Math.ceil(REMINDER_COOLDOWN_MS / 1000),
      nextAllowedAt: new Date(now.getTime() + REMINDER_COOLDOWN_MS).toISOString(),
    };
  }

  let sent: ReminderSendResult;
  try {
    sent = await input.send();
  } catch (err) {
    const failure = err instanceof Error ? err.message : "Could not send the reminder.";
    const restored = await restoreClaim(input.admin, input.refId, claimedAt, input.previousSentAt ?? null);
    if (restored.error) {
      return {
        outcome: "error",
        error: `${failure} The cooldown could not be cleared: ${restored.error}`,
      };
    }
    return { outcome: "error", error: failure };
  }

  if (!sent.ok && sent.error === "disabled") {
    const restored = await restoreClaim(input.admin, input.refId, claimedAt, input.previousSentAt ?? null);
    if (restored.error) return { outcome: "error", error: restored.error };
    return { outcome: "disabled" };
  }

  if (referenceSendConfirmed(sent)) {
    return { outcome: "sent", reminderSentAt: claimedAt };
  }

  if (!sent.ok && sent.suppressed && input.keepStampOnSuppressed) {
    return { outcome: "suppressed", error: sent.error || "This address is suppressed." };
  }

  const failure = !sent.ok ? sent.error : "The reminder was not sent.";
  const restored = await restoreClaim(input.admin, input.refId, claimedAt, input.previousSentAt ?? null);
  if (restored.error) {
    return {
      outcome: "error",
      error: `${failure} The cooldown could not be cleared: ${restored.error}`,
    };
  }
  return { outcome: "error", error: failure || "The reminder was not sent." };
}
