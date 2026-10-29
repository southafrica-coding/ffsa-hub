import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeOnboarding } from "@/services/users";
import { deleteOwnUnlinkedSpouses } from "@/services/household";
import { canHaveSpouse } from "@/lib/users/marital-status";
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
    .select("id, accepted_at, marital_status")
    .eq("id", user.id)
    .maybeSingle();

  if (existing?.accepted_at) {
    return NextResponse.json({ success: true, alreadyComplete: true });
  }

  // Someone who added a spouse in the Family step and then went back and
  // chose Single / Divorced / Widowed: drop that spouse row so stale spouse
  // details aren't kept. Only rows they added during this setup, never a
  // linked spouse's own account, and only before accepted_at is set — an
  // existing member's records are never touched here.
  if (!canHaveSpouse(existing?.marital_status)) {
    const { error: spouseError } = await deleteOwnUnlinkedSpouses(
      supabase,
      user.id
    );
    if (spouseError) {
      return NextResponse.json({ error: spouseError.message }, { status: 500 });
    }
  }

  const { error } = await completeOnboarding(supabase, user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The staff notice and calendar share talk to Resend and Google with no
  // time limit. They used to be awaited here, so a slow third party held the
  // wizard on "Saving…" long after the account was already set up. after()
  // runs them once the response has gone; both stay best-effort.
  const email = user.email ?? "";
  after(async () => {
    try {
      await notifyIfStaff(user.id);
    } catch (err) {
      console.error("[onboarding/complete] notify failed", err);
    }
    try {
      await shareCalendarIfStaff(user.id, email);
    } catch (err) {
      console.error("[onboarding/complete] calendar share failed", err);
    }
  });

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
  console.log(
    `[google-calendar] ${email} signup_type=${profile?.signup_type ?? "null"} isStaff=${isStaff}`
  );
  if (!isStaff) {
    const { data: roles } = await admin
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", userId)
      .eq("roles.name", "staff")
      .limit(1);
    isStaff = !!(roles && roles.length > 0);
    console.log(`[google-calendar] ${email} role-check isStaff=${isStaff}`);
  }
  if (!isStaff) {
    console.log(`[google-calendar] ${email} not staff — skipping`);
    return;
  }

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
