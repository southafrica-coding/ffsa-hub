import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTransactional } from "@/lib/email/send-transactional";
import { previewWritesDisabled } from "@/lib/preview-writes";
import { loadReminder } from "@/lib/legal/reminder-data";
import { reminderEmail, shouldSend } from "@/lib/legal/reminders";
import { todayInSA } from "@/lib/legal/status";

export const maxDuration = 60;

// GET /api/cron/legal-reminders — daily Vercel cron at 05:00 UTC (07:00
// Johannesburg). Plan: docs/legal-documents.md, step 4.
//
// Emails the OWNER on legal_access (the legal officer) — not reviewers or
// helpers — on days when a document or application hits a milestone, and
// on Mondays when anything is still open. Rules: src/lib/legal/reminders.ts.
//
// A system job, so it reads with the service role; what it sends is titles
// and dates only, to the owner only.
//
// OFF BY DEFAULT. Sends only when switched on: VERCEL_ENV=production,
// preview writes not disabled, AND LEGAL_REMINDERS_ACTIVE=1. Until then (and
// anywhere else) it builds the email and reports what it would have done. The day is claimed in
// legal_reminder_sends (migration 373) BEFORE anything is sent, so a
// doubled run never emails twice.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

async function owners(admin: Client, today: string): Promise<string[]> {
  const { data, error } = await admin
    .from("legal_access")
    .select("ends_on, users:user_id(email, is_active)")
    .eq("access_role", "owner")
    .is("folder_id", null);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r: { ends_on: string | null }) => !r.ends_on || r.ends_on >= today)
    .map((r: { users: { email: string | null; is_active: boolean | null } | null }) => r.users)
    .filter((u: { email: string | null; is_active: boolean | null } | null) => u?.email && u.is_active !== false)
    .map((u: { email: string }) => u.email);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayInSA();
  const admin: Client = createAdminClient();

  let reminder;
  let to: string[];
  try {
    [reminder, to] = await Promise.all([loadReminder(admin, today), owners(admin, today)]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  if (!shouldSend(reminder, today)) return NextResponse.json({ ok: true, today, sent: 0, reason: "nothing today" });
  if (to.length === 0) return NextResponse.json({ ok: true, today, sent: 0, reason: "no owner on the access list" });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com";
  const email = reminderEmail(reminder, today, appUrl);

  // OFF until Gideon and Jack say to activate it (18 Nov 2026): the email
  // goes out only when LEGAL_REMINDERS_ACTIVE=1 is set on production.
  const live =
    process.env.VERCEL_ENV === "production" &&
    !previewWritesDisabled() &&
    process.env.LEGAL_REMINDERS_ACTIVE === "1";
  if (!live) {
    return NextResponse.json({
      ok: true,
      today,
      dryRun: true,
      reason: "reminders are not switched on (LEGAL_REMINDERS_ACTIVE)",
      subject: email.subject,
      recipients: to.length,
    });
  }

  const lines = [...reminder.today, ...reminder.open];
  const { error: claimError } = await admin.from("legal_reminder_sends").insert({
    send_date: today,
    recipients: to.length,
    document_ids: lines.filter((l) => l.kind === "document").map((l) => l.id),
    application_ids: lines.filter((l) => l.kind === "application").map((l) => l.id),
  });
  if (claimError) {
    if (claimError.code === "23505") return NextResponse.json({ ok: true, today, sent: 0, reason: "already sent today" });
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  let sent = 0;
  const errors: string[] = [];
  for (const address of to) {
    const result = await sendTransactional({
      to: address,
      subject: email.subject,
      html: email.html,
      text: email.text,
      category: "legal_reminder",
      sourceType: "legal_reminder",
      reason: "You look after FFSA's legal papers in the Hub, and something needs renewing or applying for.",
    });
    if (result.ok) sent++;
    else errors.push(result.error);
  }
  await admin
    .from("legal_reminder_sends")
    .update({ sent, error: errors.length ? errors.join("; ").slice(0, 1000) : null })
    .eq("send_date", today);

  return NextResponse.json({ ok: errors.length === 0, today, sent, failed: errors.length });
}
