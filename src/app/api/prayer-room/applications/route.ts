import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApplications, createApplication } from "@/services/prayer-room-applications";
import { isPrayerRoomStaff } from "@/lib/auth/prayer-room-access";
import { sendPrayerRoomApplicationReceived } from "@/lib/email/send-prayer-room";

// GET — pipeline lists. scope=all (staff) | assigned (evaluator) | mine (default).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "mine";
  const status = url.searchParams.get("status") ?? undefined;

  let result;
  if (scope === "all") {
    if (!(await isPrayerRoomStaff(supabase, user.id))) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    result = await getApplications(createAdminClient(), { status });
  } else if (scope === "assigned") {
    result = await getApplications(createAdminClient(), { evaluatorId: user.id, status });
  } else {
    result = await getApplications(supabase, { applicantId: user.id });
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json(result.data);
}

// POST — apply to serve (RLS: applicant must be self).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  // Seats now, not labels (migration 181). Each carries the applicant's own
  // claim about having been evaluated for it before — a claim, never a fact.
  const seats = Array.isArray(body.seats)
    ? (body.seats as { seat_type_id?: unknown; previously_evaluated?: unknown }[])
        .filter((s) => typeof s?.seat_type_id === "string" && s.seat_type_id)
        .map((s) => ({
          seat_type_id: s.seat_type_id as string,
          previously_evaluated: s.previously_evaluated === true,
        }))
    : [];

  const { data, error } = await createApplication(supabase, {
    applicant_id: user.id,
    background: (body.background as string) ?? null,
    seats,
  });
  if (error || !data) {
    // 23505 = unique violation → already has an in-flight application
    const status = error?.code === "23505" ? 409 : 400;
    const message = error?.code === "23505" ? "You already have an application in progress." : error?.message ?? "Failed to apply";
    return NextResponse.json({ error: message }, { status });
  }

  // confirmation email (best-effort)
  const { data: me } = await supabase
    .from("users")
    .select("first_name, preferred_name, email")
    .eq("id", user.id)
    .single();
  await sendPrayerRoomApplicationReceived(me ?? { email: user.email });

  return NextResponse.json(data);
}
