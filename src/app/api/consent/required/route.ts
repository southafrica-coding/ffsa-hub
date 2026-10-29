import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequiredConsentStatus } from "@/services/consent";
import { userIsStaff } from "@/lib/users/is-staff";

// GET /api/consent/required — every policy the CALLER must sign, and whether
// they already have. Backs the onboarding wizard's consent step so it asks
// the same people for the same policies as the profile-completion gate
// (invited staff have no signup_type, only the staff role, and used to meet
// the NDA on its own after onboarding), and so a signature already on record
// shows as signed after a reload instead of asking again.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: row } = await supabase
    .from("users")
    .select("signup_type")
    .eq("id", user.id)
    .maybeSingle();

  const isStaff = await userIsStaff(supabase, user.id, row ?? {});
  const status = await getRequiredConsentStatus(supabase, user.id, isStaff);

  return NextResponse.json({
    agreements: status.map((s) => ({
      kind: s.kind,
      version: s.agreement.version,
      title: s.agreement.title,
      accepted: s.accepted,
      accepted_at: s.accepted_at,
    })),
  });
}
