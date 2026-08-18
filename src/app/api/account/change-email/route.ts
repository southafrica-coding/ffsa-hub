import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signEmailChangeToken } from "@/lib/tokens/email-change";
import { emailChangeConfirmHtml } from "@/lib/email/templates/email-change";
import { getResend } from "@/lib/email/resend";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const newEmail =
    typeof body?.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
  const currentPassword =
    typeof body?.currentPassword === "string" ? body.currentPassword : "";

  if (!newEmail || !newEmail.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (newEmail === (user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "That's already your email address." }, { status: 400 });
  }

  // Re-authenticate with the current password using a throwaway client that
  // doesn't touch the user's session cookies (so this check can't rotate or
  // clobber their live session).
  const verifier = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );
  const { error: reauthErr } = await verifier.auth.signInWithPassword({
    email: user.email ?? "",
    password: currentPassword,
  });
  if (reauthErr) {
    return NextResponse.json({ error: "Your current password is incorrect." }, { status: 403 });
  }

  const admin = createAdminClient();

  // Reject if the new email is already in use.
  const { data: taken } = await admin
    .from("users")
    .select("id")
    .ilike("email", newEmail)
    .maybeSingle();
  if (taken) {
    return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const token = signEmailChangeToken(user.id, newEmail);
  const confirmUrl = `${siteUrl}/account/confirm-email?token=${encodeURIComponent(token)}`;

  const { data: profile } = await admin
    .from("users")
    .select("first_name")
    .eq("id", user.id)
    .maybeSingle();

  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  try {
    await getResend().emails.send({
      from: `Fire & Fragrance SA <${fromEmail}>`,
      to: newEmail,
      subject: "Confirm your new FFSA Hub email",
      html: emailChangeConfirmHtml({
        firstName: profile?.first_name || undefined,
        confirmUrl,
        newEmail,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't send the confirmation email. Please try again." },
      { status: 500 }
    );
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "email_change_requested",
    resource_type: "users",
    resource_id: user.id,
    changes: { to: newEmail },
  });

  return NextResponse.json({ ok: true });
}
