import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { getTrackSegments } from "@/lib/schools/track-segments";
import { recordTrackChoice } from "@/lib/schools/track-pipeline";

export async function POST(request: Request) {
  const body = await request.json();
  const token = typeof body.token === "string" ? body.token : "";
  const wholeProgram = body.whole_program === true;
  const requestedCodes: unknown[] = Array.isArray(body.segment_codes)
    ? body.segment_codes
    : [];

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const { data: survey } = await supabase
    .from("ffx_track_intent_surveys")
    .select("id, application_response_id, application_responses(program_id)")
    .eq("token", token)
    .maybeSingle();

  if (!survey) {
    return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  }

  const segments = await getTrackSegments(
    supabase,
    survey.application_responses?.program_id,
    ["active", "upcoming", "completed"]
  );
  const validCodes = new Set(segments.map((c) => c.code));

  let segmentCodes: string[] = [];
  if (!wholeProgram) {
    segmentCodes = requestedCodes.filter(
      (c): c is string => typeof c === "string" && validCodes.has(c)
    );
    if (segmentCodes.length === 0) {
      return NextResponse.json(
        { error: "Please choose at least one section, or the whole programme." },
        { status: 400 }
      );
    }
  }

  const { error } = await supabase
    .from("ffx_track_intent_surveys")
    .update({
      intent: wholeProgram
        ? { whole_program: true }
        : { whole_program: false, segments: segmentCodes },
      submitted_at: new Date().toISOString(),
    })
    .eq("id", survey.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to save your answer. Please try again." },
      { status: 500 }
    );
  }

  // Land the answer where the school can see it: the application's track,
  // and the enrolment's too once they're accepted. Never touches billing.
  try {
    await recordTrackChoice(supabase, {
      applicationId: survey.application_response_id,
      wholeProgram,
      courseIds: segments.filter((c) => segmentCodes.includes(c.code)).map((c) => c.id),
    });
  } catch (err) {
    console.error("[track-intent] recordTrackChoice failed", err);
  }

  return NextResponse.json({ success: true });
}
