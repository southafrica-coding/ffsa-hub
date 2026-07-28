import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if (!adminCheck || adminCheck.length === 0) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { user_id } = body;

  if (!user_id) {
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 }
    );
  }

  // Prevent self-deletion
  if (user_id === authUser.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();

  // Verify user exists
  const { data: targetUser } = await adminSupabase
    .from("users")
    .select("id, email, first_name, last_name, display_name")
    .eq("id", user_id)
    .single();

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Preserve an alternate identifier on records that require one, so the
  // ON DELETE SET NULL on their user_id doesn't violate their
  // "at least one identifier" check constraint when the user is removed.
  // (consent_records: user_id OR applicant_email; event_roles: user_id OR
  //  contact_id OR display_name.)
  const tu = targetUser as {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
  };
  const fallbackName =
    tu.display_name?.trim() ||
    [tu.first_name, tu.last_name].filter(Boolean).join(" ").trim() ||
    tu.email ||
    "Former user";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = adminSupabase as any;

  if (tu.email) {
    await admin
      .from("consent_records")
      .update({ applicant_email: tu.email })
      .eq("user_id", user_id)
      .is("applicant_email", null);
  } else {
    // No email to fall back on — drop the orphan-able consent rows.
    await admin
      .from("consent_records")
      .delete()
      .eq("user_id", user_id)
      .is("applicant_email", null);
  }

  await admin
    .from("event_roles")
    .update({ display_name: fallbackName })
    .eq("user_id", user_id)
    .is("contact_id", null)
    .is("display_name", null);

  // 1. Delete user_roles
  await adminSupabase.from("user_roles").delete().eq("user_id", user_id);

  // 2. Delete app-level user record
  const { error: deleteError } = await adminSupabase
    .from("users")
    .delete()
    .eq("id", user_id);

  if (deleteError) {
    return NextResponse.json(
      { error: `Failed to delete user: ${deleteError.message}` },
      { status: 500 }
    );
  }

  // 3. Delete from Supabase Auth
  const { error: authDeleteError } =
    await adminSupabase.auth.admin.deleteUser(user_id);

  if (authDeleteError) {
    return NextResponse.json(
      { error: `User record deleted but auth cleanup failed: ${authDeleteError.message}` },
      { status: 500 }
    );
  }

  // Audit log
  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "delete",
    resource_type: "users",
    resource_id: user_id,
    changes: { deleted_user_id: user_id },
  });

  return NextResponse.json({ success: true });
}
