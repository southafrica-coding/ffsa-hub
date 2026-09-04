import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupAccountByEmail } from "@/lib/auth/account-state";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { code, email, password, first_name, last_name } = body as {
    code?: string;
    email?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
  };

  if (!code || !email || !password) {
    return NextResponse.json(
      { error: "code, email, and password are required" },
      { status: 400 }
    );
  }

  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();

  // Resolve the code to its signup link type. The type is resolved
  // server-side from the code (authoritative) — never trust a type
  // sent by the client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link } = await (adminSupabase as any)
    .from("signup_links")
    .select("type, enabled")
    .eq("code", code)
    .maybeSingle();

  if (!link) {
    return NextResponse.json(
      { error: "This invite link is no longer valid. Ask a super admin for an updated link." },
      { status: 403 }
    );
  }

  if (!link.enabled) {
    return NextResponse.json(
      { error: "This signup link is currently disabled. Ask a super admin to invite you directly." },
      { status: 403 }
    );
  }

  const signupType = link.type as "staff" | "student" | "community";

  // Map the signup type to the access role granted on top of the
  // self_service floor.
  const typeRoleName =
    signupType === "staff"
      ? "staff"
      : signupType === "student"
      ? "student"
      : "community_member";

  const normalisedEmail = email.trim().toLowerCase();

  // "Already exists — try logging in" was a locked door for the largest group
  // who reach this page: accepted applicants whose account was created without
  // a password. They cannot log in, so sending them to login is a dead end and
  // the reason admins resorted to deleting the account so it could be remade.
  // Ask what the account can actually do before answering.
  const existingAccount = await lookupAccountByEmail(
    adminSupabase,
    normalisedEmail
  );

  if (existingAccount.state === "needs_setup") {
    return NextResponse.json(
      {
        error:
          "You already have an account waiting — it just needs a password. " +
          "Use \u201cForgot password / first-time setup\u201d to get your setup link.",
        needsSetup: true,
      },
      { status: 409 }
    );
  }

  if (existingAccount.state === "active") {
    return NextResponse.json(
      { error: "An account with this email already exists. Try logging in instead." },
      { status: 409 }
    );
  }

  // Create the auth user (email pre-confirmed — they got here via a
  // trusted shareable link, no verification round-trip needed).
  const { data: created, error: createError } =
    await adminSupabase.auth.admin.createUser({
      email: normalisedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: first_name?.trim() || null,
        last_name: last_name?.trim() || null,
      },
    });

  if (createError || !created?.user?.id) {
    return NextResponse.json(
      { error: createError?.message || "Failed to create account" },
      { status: 500 }
    );
  }

  const newUserId = created.user.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (adminSupabase as any).from("users").insert({
    id: newUserId,
    email: normalisedEmail,
    first_name: first_name?.trim() || null,
    last_name: last_name?.trim() || null,
    signup_type: signupType,
    invited_at: new Date().toISOString(),
    accepted_at: new Date().toISOString(),
  });

  if (insertError) {
    // Roll back the auth user so the next attempt isn't blocked by a
    // ghost auth row that has no matching public.users record.
    await adminSupabase.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { error: `Failed to create user record: ${insertError.message}` },
      { status: 500 }
    );
  }

  // Grant the self_service floor plus the role that matches the
  // signup link type (staff / student / community_member). Every
  // user needs self_service for base access; the type role is
  // granted in addition.
  const roleNames = Array.from(new Set(["self_service", typeRoleName]));
  const { data: rolesToGrant } = await adminSupabase
    .from("roles")
    .select("id")
    .in("name", roleNames);

  if (rolesToGrant && rolesToGrant.length > 0) {
    await adminSupabase.from("user_roles").insert(
      rolesToGrant.map((role: { id: string }) => ({
        user_id: newUserId,
        role_id: role.id,
        assigned_by: newUserId,
      }))
    );
  }

  // Records Library auto-match (same behaviour as the email invite flow).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminSupabase as any).rpc("auto_link_library_records_for_user", {
      p_user_id: newUserId,
    });
  } catch {
    // Non-fatal.
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

  await adminSupabase.from("audit_logs").insert({
    user_id: newUserId,
    action: "create",
    resource_type: "users",
    resource_id: newUserId,
    changes: { email: normalisedEmail, source: `public_signup_link:${signupType}` },
  });

  return NextResponse.json({ success: true, user_id: newUserId });
}
