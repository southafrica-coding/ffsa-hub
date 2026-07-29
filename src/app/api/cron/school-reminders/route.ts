import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTransactional } from "@/lib/email/send-transactional";
import { resolveProgramEmail } from "@/lib/email/render-program-email";
import { referenceReminderEmailHtml } from "@/lib/email/templates/reference-reminder";

export const maxDuration = 60;

// GET /api/cron/school-reminders — daily Vercel cron.
//
// Auto-nudges referees who haven't returned a reference. For each program
// whose leaders set an auto-reminder on the reference_reminder email
// (program_email_templates.reminder_after_days, migration 147), it finds
// still-pending reference requests older than that many days that haven't
// been reminded yet, and sends the reminder — honoring that program's
// custom subject/body — then stamps reminder_sent_at so it goes once.
//
// Mirrors the auth + batch-drain shape of the other crons.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const PER_PROGRAM_CAP = 200;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin: Client = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";

  // Programs opted into auto reference reminders.
  const { data: configs, error: cfgErr } = await admin
    .from("program_email_templates")
    .select("program_id, reminder_after_days")
    .eq("email_type", "reference_reminder")
    .eq("enabled", true)
    .not("reminder_after_days", "is", null);
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let programs = 0;

  for (const cfg of configs ?? []) {
    const days = cfg.reminder_after_days as number;
    if (!days || days < 1) continue;
    programs += 1;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const { data: due } = await admin
      .from("reference_requests")
      .select(
        "id, token, referee_email, referee_name, created_at, reference_slots(label), application_responses!inner(id, program_id, applicant_info, users:user_id(first_name, last_name), programs(name))"
      )
      .eq("application_responses.program_id", cfg.program_id)
      .neq("status", "submitted")
      .is("reminder_sent_at", null)
      .lte("created_at", cutoff)
      .limit(PER_PROGRAM_CAP);

    for (const req of due ?? []) {
      try {
        const app = req.application_responses;
        const programName = app?.programs?.name ?? "School Program";
        const applicantName =
          (app?.users
            ? [app.users.first_name, app.users.last_name]
                .filter(Boolean)
                .join(" ")
            : [
                app?.applicant_info?.first_name,
                app?.applicant_info?.last_name,
              ]
                .filter(Boolean)
                .join(" ")) || "An applicant";
        const referenceUrl = `${siteUrl}/reference/${req.token}`;

        const defaults = {
          subject: `Reference Reminder — ${programName}`,
          html: referenceReminderEmailHtml({
            refereeName: req.referee_name,
            applicantName,
            programName,
            slotLabel: req.reference_slots?.label ?? "Reference",
            referenceUrl,
          }),
        };

        const resolved = await resolveProgramEmail(
          admin,
          cfg.program_id,
          "reference_reminder",
          defaults,
          {
            programName,
            heading: "A reference is waiting",
            cta: { label: "Complete the reference", url: referenceUrl },
            siteUrl,
          }
        );

        if (resolved.skip) {
          skipped += 1;
          continue;
        }

        const result = await sendTransactional({
          to: req.referee_email,
          subject: resolved.subject,
          html: resolved.html,
          category: "reference_reminder",
          sourceType: "school_application",
          sourceId: app?.id ?? null,
        });

        // Stamp reminder_sent_at whenever the send left our hands (sent,
        // or dropped-because-suppressed) so we don't retry a bad address
        // every night. A hard provider error leaves it null to try again.
        const stamp = () =>
          admin
            .from("reference_requests")
            .update({ reminder_sent_at: new Date().toISOString() })
            .eq("id", req.id);

        if (result.ok) {
          sent += 1;
          await stamp();
        } else {
          skipped += 1;
          if (result.suppressed) await stamp();
        }
      } catch (e) {
        console.error("[school-reminders] failed for request", req.id, e);
        skipped += 1;
      }
    }
  }

  return NextResponse.json({ programs, sent, skipped });
}
