import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteEmailHtml } from "@/lib/email/templates/invite";
import { getResend } from "@/lib/email/resend";

export async function POST(request: Request) {
  // Verify the calling user is an admin
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Check admin role
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
  const { email, first_name, last_name } = body;

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // Check if a user with this email already exists
  const { data: existingUser } = await adminSupabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  // Generate invite link without sending Supabase's default email
  const { data: linkData, error: linkError } =
    await adminSupabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: `${siteUrl}/auth/confirm`,
      },
    });

  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkError?.message || "Failed to generate invite link" },
      { status: 500 }
    );
  }

  const inviteUrl = linkData.properties.action_link;

  // Send branded email via Resend
  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  const { error: emailError } = await getResend().emails.send({
    from: `Fire & Fragrance SA <${fromEmail}>`,
    to: email,
    subject: "You're invited to FFSA Hub",
    html: inviteEmailHtml({
      firstName: first_name || undefined,
      inviteUrl,
    }),
  });

  if (emailError) {
    return NextResponse.json(
      { error: `Failed to send invite email: ${emailError.message}` },
      { status: 500 }
    );
  }

  // Create app-level user record
  const newUserId = linkData.user?.id;
  if (!newUserId) {
    return NextResponse.json({ error: "Failed to get user ID" }, { status: 500 });
  }

  const { error: userError } = await adminSupabase.from("users").insert({
    id: newUserId,
    email: email,
    first_name: first_name || null,
    last_name: last_name || null,
    invited_at: new Date().toISOString(),
  });

  if (userError) {
    return NextResponse.json(
      { error: `Failed to create user record: ${userError.message}` },
      { status: 500 }
    );
  }

  // Assign default self_service role
  const { data: selfServiceRole } = await adminSupabase
    .from("roles")
    .select("id")
    .eq("name", "self_service")
    .single();

  if (selfServiceRole) {
    await adminSupabase.from("user_roles").insert({
      user_id: newUserId,
      role_id: selfServiceRole.id,
      assigned_by: authUser.id,
    });
  }

  // Audit log
  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "create",
    resource_type: "users",
    resource_id: newUserId,
    changes: { email, first_name, last_name },
  });

  // Records Library auto-match: link any pre-imported records
  // for this person to their new user account. High-confidence
  // matches (email + last name) auto-link; medium ones queue.
  let libraryMatch = { auto_linked: 0, queued: 0 };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcData } = await (adminSupabase as any).rpc(
      "auto_link_library_records_for_user",
      { p_user_id: newUserId }
    );
    if (Array.isArray(rpcData) && rpcData[0]) {
      libraryMatch = {
        auto_linked: rpcData[0].auto_linked ?? 0,
        queued: rpcData[0].queued ?? 0,
      };
    }
  } catch {
    // Non-fatal: surface in logs but don't block the invite.
  }

  // Household match (migration 181): if a Hub member already entered this
  // person as their spouse using this email, flag the household as a PENDING
  // match. Nothing is shared until they confirm it on their next sign-in —
  // then they inherit the family and skip the spouse/children questions.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminSupabase as any).rpc("link_household_on_signup", {
      p_user_id: newUserId,
    });
  } catch {
    // Non-fatal — they simply get their own household.
  }

  return NextResponse.json({
    success: true,
    user_id: newUserId,
    library_match: libraryMatch,
  });
}
