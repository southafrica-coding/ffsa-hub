import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { inviteEmailHtml } from "@/lib/email/templates/invite";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());

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
    .select("id, email, first_name, accepted_at")
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

  if (targetUser.accepted_at) {
    return NextResponse.json(
      {
        error:
          "This user has already accepted their invite. Use the profile reminder instead.",
      },
      { status: 400 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const { data: linkData, error: linkError } =
    await adminSupabase.auth.admin.generateLink({
      type: "invite",
      email: targetUser.email,
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

  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  const { error: sendError } = await resend.emails.send({
    from: `Fire & Fragrance SA <${fromEmail}>`,
    to: targetUser.email,
    subject: "Reminder: You're invited to FFSA Hub",
    html: inviteEmailHtml({
      firstName: targetUser.first_name || undefined,
      inviteUrl: linkData.properties.action_link,
    }),
  });

  if (sendError) {
    return NextResponse.json(
      { error: `Failed to send invite email: ${sendError.message}` },
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
