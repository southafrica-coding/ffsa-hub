import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { profileReminderEmailHtml } from "@/lib/email/templates/profile-reminder";
import { getMissingProfileFields } from "@/lib/users/profile-fields";

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
    .select("*")
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

  const missingFields = getMissingProfileFields(
    targetUser as Record<string, unknown>
  );

  if (missingFields.length === 0) {
    return NextResponse.json(
      { error: "This user's profile is already complete" },
      { status: 400 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const signInUrl = `${siteUrl}/sign-in`;

  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  const { error: sendError } = await resend.emails.send({
    from: `Fire & Fragrance SA <${fromEmail}>`,
    to: targetUser.email,
    subject: "A few details needed to finish your FFSA Hub profile",
    html: profileReminderEmailHtml({
      firstName: targetUser.first_name || undefined,
      missingLabels: missingFields.map((f) => f.label),
      signInUrl,
    }),
  });

  if (sendError) {
    return NextResponse.json(
      { error: `Failed to send reminder email: ${sendError.message}` },
      { status: 500 }
    );
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "send_profile_reminder",
    resource_type: "users",
    resource_id: user_id,
    changes: { missing_fields: missingFields.map((f) => f.field) },
  });

  return NextResponse.json({ success: true });
}
