import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteEmailHtml } from "@/lib/email/templates/invite";
import { sendSetupLink } from "@/lib/auth/send-setup-link";
import { userHasPassword } from "@/lib/auth/account-state";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin"])
    .limit(1);

  if (!adminCheck || adminCheck.length === 0) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { user_id } = body;

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const { data: targetUser, error: lookupError } = await adminSupabase
    .from("users")
    .select("id, email, first_name")
    .eq("id", user_id)
    .single();

  if (lookupError || !targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!targetUser.email) {
    return NextResponse.json(
      { error: "User has no email on file" },
      { status: 400 }
    );
  }

  // accepted_at was the wrong question. It records that an invite was taken
  // up, not that a password exists — so this refused to help people who had
  // clicked through but never finished, and helped people who were already
  // signed in. Ask the only thing that decides whether a setup link is useful.
  if (await userHasPassword(adminSupabase, targetUser.id)) {
    return NextResponse.json(
      {
        error:
          "This user already has a password. Use the profile reminder instead, " +
          "or they can reset it from the login page.",
      },
      { status: 400 }
    );
  }

  // Send through sendSetupLink, not raw Resend. The raw path wrote no ledger
  // row and skipped the suppression list, so a reminder to a bounced address
  // reported success and vanished — the admin-side twin of the silent failure
  // on /forgot-password.
  const sendResult = await sendSetupLink(adminSupabase, {
    userId: targetUser.id,
    email: targetUser.email,
    firstName: targetUser.first_name,
    createdBy: authUser.id,
    subject: "Reminder: You're invited to FFSA Hub",
    html: (setupUrl) =>
      inviteEmailHtml({
        firstName: targetUser.first_name || undefined,
        inviteUrl: setupUrl,
      }),
    category: "account_setup_link",
    sourceType: "users",
    sourceId: targetUser.id,
    reason: "An admin resent their FFSA Hub invite from the Users page.",
  });

  if (!sendResult.ok) {
    return NextResponse.json(
      {
        error: sendResult.suppressed
          ? "That email address has bounced before, so we can't send to it. " +
            "Use \u201cCopy setup link\u201d and send it to them directly."
          : `Failed to send invite email: ${sendResult.error}`,
        suppressed: sendResult.suppressed ?? false,
      },
      { status: 500 }
    );
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "resend_invite",
    resource_type: "users",
    resource_id: user_id,
    changes: { email: targetUser.email },
  });

  return NextResponse.json({ success: true });
}
