import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { sendTransactional } from "@/lib/email/send-transactional";
import { ffxTrackIntentEmailHtml } from "@/lib/email/templates/ffx-track-intent";
import { loadTrackPipeline, type PipelinePerson } from "@/lib/schools/track-pipeline";

// "Which part are you doing?" — preview and send for one school.
//
//   GET  ?mode=send|remind   a dry run: exactly who WOULD get the email
//   POST { mode }            sends it
//
// send    → everyone in the pipeline (applying or accepted) whose track isn't
//           known anywhere and who hasn't been emailed yet.
// remind  → emailed, still no answer, not reminded before. One reminder each.
//
// Both are idempotent: a person already emailed (or reminded) is skipped, so
// running a send twice can't double-mail anyone.
export const maxDuration = 60;

type Mode = "send" | "remind";

function parseMode(value: unknown): Mode | null {
  return value === "send" || value === "remind" ? value : null;
}

function pick(people: PipelinePerson[], mode: Mode): PipelinePerson[] {
  return people.filter((p) => {
    if (!p.email || p.track.kind !== "unknown") return false;
    return mode === "send"
      ? p.survey.state === "not_sent"
      : p.survey.state === "sent" && !p.survey.remindedAt;
  });
}

async function authorise(programId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await userCanManageProgram(supabase, user.id, programId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ programId: string }> }
) {
  const { programId } = await params;
  const denied = await authorise(programId);
  if (denied) return denied;

  const mode = parseMode(new URL(request.url).searchParams.get("mode"));
  if (!mode) return NextResponse.json({ error: "mode must be send or remind" }, { status: 400 });

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { people } = await loadTrackPipeline(admin, programId);
  const recipients = pick(people, mode).map((p) => ({
    name: p.name,
    email: p.email,
    status: p.status,
  }));
  return NextResponse.json({ mode, count: recipients.length, recipients });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ programId: string }> }
) {
  const { programId } = await params;
  const denied = await authorise(programId);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const mode = parseMode(body.mode);
  if (!mode) return NextResponse.json({ error: "mode must be send or remind" }, { status: 400 });

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { segments, people } = await loadTrackPipeline(admin, programId);
  const { data: program } = await admin.from("programs").select("name").eq("id", programId).maybeSingle();
  const programName: string = program?.name ?? "the programme";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const segmentNames = segments.map((s) => s.code);

  let sent = 0;
  const failed: Array<{ email: string; detail: string }> = [];

  for (const p of pick(people, mode)) {
    const email = p.email as string;

    const { data: existing } = await admin
      .from("ffx_track_intent_surveys")
      .select("id, token")
      .eq("application_response_id", p.applicationId)
      .maybeSingle();

    let surveyId: string | undefined = existing?.id;
    let token: string | undefined = existing?.token;
    if (!surveyId) {
      const { data: created, error: insertError } = await admin
        .from("ffx_track_intent_surveys")
        .insert({ application_response_id: p.applicationId, email })
        .select("id, token")
        .single();
      if (insertError || !created) {
        failed.push({ email, detail: insertError?.message ?? "could not create survey link" });
        continue;
      }
      surveyId = created.id;
      token = created.token;
    }

    const firstName = p.name === "Unknown" ? "there" : p.name.split(" ")[0];
    const result = await sendTransactional({
      to: email,
      subject:
        mode === "remind"
          ? `Reminder: which part of ${programName} are you doing?`
          : `Which part of ${programName} are you doing?`,
      html: ffxTrackIntentEmailHtml({
        firstName,
        surveyUrl: `${siteUrl}/track-intent/${token}`,
        siteUrl,
        programName,
        segmentNames,
        reminder: mode === "remind",
      }),
      category: "ffx_track_intent_survey",
      sourceType: "application_responses",
      sourceId: p.applicationId,
      reason:
        mode === "remind"
          ? "Reminder for the survey confirming whether they're doing the whole programme or specific sections."
          : "Survey confirming whether they're doing the whole programme or specific sections.",
    });

    if (!result.ok) {
      failed.push({ email, detail: result.error ?? "send failed" });
      continue;
    }

    await admin
      .from("ffx_track_intent_surveys")
      .update(
        mode === "remind"
          ? { reminder_sent_at: new Date().toISOString() }
          : { email_sent_at: new Date().toISOString() }
      )
      .eq("id", surveyId);
    sent++;
  }

  return NextResponse.json({ mode, sent, failed });
}
