import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeOnboarding } from "@/services/users";
import { sendNewStaffOnboardedNotice } from "@/lib/email/send-new-staff-notice";
import { addUserToBaseCalendar } from "@/lib/google/calendar";

// Finishes the onboarding wizard for the CALLER (never a body-supplied id) and,
// for staff, notifies the people on STAFF_SIGNUP_NOTIFY_EMAIL.
//
// This used to be a direct client-side completeOnboarding() call from the
// wizard; it moved here because the email can only be sent server-side.
// Idempotent: a second POST after accepted_at is set changes nothing and
// re-sends nothing.

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("users")
    .select("id, accepted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (existing?.accepted_at) {
    return NextResponse.json({ success: true, alreadyComplete: true });
  }

  const { error } = await completeOnboarding(supabase, user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort notice — onboarding must never fail because Resend is down.
  try {
    await notifyIfStaff(user.id);
  } catch (err) {
    console.error("[onboarding/complete] notify failed", err);
  }

  // Best-effort calendar share — must never fail onboarding.
  try {
    await shareCalendarIfStaff(user.id, user.email ?? "");
  } catch (err) {
    console.error("[onboarding/complete] calendar share failed", err);
  }

  return NextResponse.json({ success: true });
}

async function shareCalendarIfStaff(userId: string, email: string) {
  if (!email) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();

  const { data: profile } = await admin
    .from("users")
    .select("signup_type")
    .eq("id", userId)
    .maybeSingle();

  let isStaff = profile?.signup_type === "staff";
  if (!isStaff) {
    const { data: roles } = await admin
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", userId)
      .eq("roles.name", "staff")
      .limit(1);
    isStaff = !!(roles && roles.length > 0);
  }
  if (!isStaff) return;

  await addUserToBaseCalendar(email);
}

async function notifyIfStaff(userId: string) {
  // Service-role: we need this user's own row plus their roles, and the
  // notice is a system action rather than something the user is reading.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();

  const { data: profile } = await admin
    .from("users")
    .select(
      "id, first_name, last_name, display_name, email, phone, job_title, department, signup_type"
    )
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return;

  let isStaff = profile.signup_type === "staff";
  if (!isStaff) {
    const { data: roles } = await admin
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", userId)
      .eq("roles.name", "staff")
      .limit(1);
    isStaff = !!(roles && roles.length > 0);
  }
  if (!isStaff) return; // students and community signups don't notify

  await sendNewStaffOnboardedNotice(profile);
}
