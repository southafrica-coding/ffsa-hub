import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// One-off FFX track-intent survey (migration 222) — see that migration's
// comment for why this doesn't reuse the migration-221 segment picker.
const FFX_PROGRAM_ID = "f839fd44-0051-4d47-ab8d-b548c5d32648";

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
    .select("id")
    .eq("token", token)
    .maybeSingle();

  if (!survey) {
    return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  }

  const { data: courseRows } = await supabase
    .from("billing_courses")
    .select("code")
    .eq("program_id", FFX_PROGRAM_ID);
  const validCodes = new Set(
    (courseRows ?? []).map((c: { code: string }) => c.code)
  );

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

  return NextResponse.json({ success: true });
}
