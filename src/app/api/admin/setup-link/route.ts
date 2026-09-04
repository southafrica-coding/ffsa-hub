// FFSA Hub — mint a setup link and hand it back, without sending anything.
//
// Every other path to a setup link goes through email, which leaves one group
// permanently unreachable: an address on the suppression list (it bounced
// before) is dropped by sendTransactional, so resending can never work no
// matter how many times an admin clicks. Until now the only remaining move was
// to delete the person's account so they could sign up again — and deleting a
// user is what unlinks their application (migration 200).
//
// This returns the URL instead. The admin sends it however they like, and the
// account survives.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createOnboardingInvite,
} from "@/lib/auth/onboarding-invite";
import { resolveSiteUrl } from "@/lib/auth/send-setup-link";
import { userHasPassword } from "@/lib/auth/account-state";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Same gate as resending an invite: a setup link is a credential, so this is
  // deliberately no easier to obtain than the emailed one.
  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin"])
    .limit(1);

  if (!adminCheck || adminCheck.length === 0) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { user_id } = body as { user_id?: string };

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const { data: targetUser, error: lookupError } = await adminSupabase
    .from("users")
    .select("id, email")
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

  // A setup link overwrites whatever password exists when it is used, so it
  // must never be handed out for an account that already has one.
  if (await userHasPassword(adminSupabase, targetUser.id)) {
    return NextResponse.json(
      {
        error:
          "This user already has a password. They can reset it themselves from " +
          "the login page.",
      },
      { status: 400 }
    );
  }

  const invite = await createOnboardingInvite(adminSupabase, {
    userId: targetUser.id,
    email: targetUser.email,
    siteUrl: resolveSiteUrl(),
    createdBy: authUser.id,
  });

  if (!invite.ok) {
    return NextResponse.json(
      { error: `Could not create setup link: ${invite.error}` },
      { status: 500 }
    );
  }

  // Worth an audit row of its own: unlike a resend, nothing else records that
  // this link left the building.
  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "setup_link_copied",
    resource_type: "users",
    resource_id: targetUser.id,
    changes: { email: targetUser.email },
  });

  return NextResponse.json({ url: invite.url, email: targetUser.email });
}
