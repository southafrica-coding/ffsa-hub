// Sending for account deletion requests. Every send goes through
// sendTransactional (suppression check + email ledger), one email per
// recipient so no admin sees the others' addresses.
//
// Recipients: ACCOUNT_DELETION_NOTIFY_EMAIL when set; otherwise every active
// super_admin / admin. Nothing here ever throws: a failure comes back as
// sent: 0 and the route decides what to tell the person.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendTransactional } from "@/lib/email/send-transactional";
import { getActiveUserEmails, getUserAdminIds } from "@/services/account-deletion";
import { deletionContactEmail, deletionNotifyEmailsFromEnv } from "./config";
import {
  deletionCancelledAdminEmail,
  deletionRequestAdminEmail,
  deletionRequestConfirmationEmail,
  type DeletionPerson,
} from "./emails";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com").replace(
    /\/+$/,
    ""
  );
}

/** Who gets the admin notices. Empty when nobody could be found. */
export async function deletionRecipients(): Promise<string[]> {
  const fromEnv = deletionNotifyEmailsFromEnv();
  if (fromEnv.length > 0) return fromEnv;
  try {
    const admin = createAdminClient();
    const { data: roleRows, error } = await getUserAdminIds(admin);
    if (error) throw error;
    const ids = [...new Set(((roleRows ?? []) as { user_id: string }[]).map((r) => r.user_id))];
    if (ids.length === 0) return [];
    const { data: users, error: usersError } = await getActiveUserEmails(admin, ids);
    if (usersError) throw usersError;
    return [
      ...new Set(
        ((users ?? []) as { email: string | null }[])
          .map((u) => (u.email ?? "").trim().toLowerCase())
          .filter((e) => e.includes("@"))
      ),
    ];
  } catch (err) {
    console.error("[account-deletion] couldn't list admins", err);
    return [];
  }
}

async function sendToAll(
  recipients: string[],
  email: { subject: string; html: string },
  category: string,
  sourceId: string
): Promise<number> {
  let sent = 0;
  for (const to of recipients) {
    try {
      const result = await sendTransactional({
        to,
        subject: email.subject,
        html: email.html,
        category,
        sourceType: "user",
        sourceId,
        reason: "You can delete user accounts in the FFSA Hub",
      });
      if (result.ok) sent += 1;
      else console.error("[account-deletion] admin send failed", category, result.error);
    } catch (err) {
      console.error("[account-deletion] admin send threw", category, err);
    }
  }
  return sent;
}

export async function notifyAdminsOfRequest(args: {
  person: DeletionPerson;
  reason: string | null;
  requestedAt: string;
  source: "app" | "web";
  recorded: boolean;
}): Promise<{ sent: number }> {
  const recipients = await deletionRecipients();
  if (recipients.length === 0) return { sent: 0 };
  const email = deletionRequestAdminEmail({ ...args, siteUrl: siteUrl() });
  return { sent: await sendToAll(recipients, email, "account_deletion_request", args.person.userId) };
}

export async function notifyAdminsOfCancel(person: DeletionPerson): Promise<{ sent: number }> {
  const recipients = await deletionRecipients();
  if (recipients.length === 0) return { sent: 0 };
  const email = deletionCancelledAdminEmail({ person, siteUrl: siteUrl() });
  return { sent: await sendToAll(recipients, email, "account_deletion_cancelled", person.userId) };
}

export async function sendDeletionConfirmation(args: {
  person: DeletionPerson;
  requestedAt: string;
}): Promise<boolean> {
  if (!args.person.email) return false;
  const email = deletionRequestConfirmationEmail({
    name: args.person.name,
    requestedAt: args.requestedAt,
    contactEmail: deletionContactEmail(),
    siteUrl: siteUrl(),
  });
  try {
    const result = await sendTransactional({
      to: args.person.email,
      subject: email.subject,
      html: email.html,
      category: "account_deletion_confirmation",
      sourceType: "user",
      sourceId: args.person.userId,
      reason: "You asked for your FFSA Hub account to be deleted",
    });
    if (!result.ok) console.error("[account-deletion] confirmation failed", result.error);
    return result.ok;
  } catch (err) {
    console.error("[account-deletion] confirmation threw", err);
    return false;
  }
}
