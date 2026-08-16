import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordSeatEvaluation, listQualificationsFor } from "@/services/prayer-room-seats";

/**
 * GET  — a person's qualifications (state only, no notes).
 * POST — record a seat evaluation: the two notes plus the resulting state.
 *
 * Neither reads private_note back out. Evaluators fetch their own history
 * through the base table; the SUBJECT only ever reads
 * prayer_room_my_evaluations, which does not contain that column at all
 * (migration 169).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);

  // The caller's own feedback. Served from prayer_room_my_evaluations, which
  // does not contain private_note — the base table is never queried here, so
  // there is no path by which the private note could be selected.
  if (url.searchParams.get("mine") === "feedback") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    try {
      const { data, error } = await db
        .from("prayer_room_my_evaluations")
        .select("id, seat_type_id, seat_label, outcome, feedback, created_at")
        .order("created_at", { ascending: false });
      return NextResponse.json(error ? [] : data ?? []);
    } catch {
      return NextResponse.json([]);
    }
  }

  const userId = url.searchParams.get("userId");

  // Reading your own is always fine. Reading someone else's states is what a
  // lead needs to fill a seat, and RLS on the table decides that — not this
  // route.
  const target = userId || user.id;
  return NextResponse.json(await listQualificationsFor(supabase, target));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.user_id || !body?.seat_type_id || !body?.outcome) {
    return NextResponse.json(
      { error: "user_id, seat_type_id and outcome are required" },
      { status: 400 }
    );
  }

  const VALID = ["not_yet", "in_training", "signed_off"];
  if (!VALID.includes(body.outcome)) {
    return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  }

  // Whether this person may evaluate THIS seat is enforced by can_evaluate_seat
  // in RLS (migration 168), so a scoped evaluator gets a database-level refusal
  // rather than a check we could forget to write here.
  const { error } = await recordSeatEvaluation(supabase, {
    user_id: body.user_id,
    seat_type_id: body.seat_type_id,
    evaluator_id: user.id,
    outcome: body.outcome,
    feedback: body.feedback,
    private_note: body.private_note,
    observed_set_id: body.observed_set_id,
  });

  if (error) {
    return NextResponse.json(
      { error: (error as { message?: string }).message ?? "Could not save the evaluation" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
