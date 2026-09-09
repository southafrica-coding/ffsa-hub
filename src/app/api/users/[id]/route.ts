import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, hasAnyRole } from "@/lib/api-auth";
import { getMinistryBySlug } from "@/services/ministries";
import { normalizeInsuranceWrite } from "@/lib/users/insurance-write";

const ADMIN_ROLES = ["super_admin", "admin"];

// Profile fields an admin may edit on another user's record. Mirrors the
// self-service allow-list in /api/profile/update, plus job_title (which the
// user themselves cannot set). Email is handled separately below because it
// is the auth identity, not just a column.
const ALLOWED_FIELDS = [
  "first_name", "last_name", "date_of_birth",
  "gender", "marital_status", "nationality", "phone",
  "department", "job_title",
  "address_line_1", "address_line_2", "city", "province",
  "country", "postal_code",
  "emergency_contact_name", "emergency_contact_phone",
  "emergency_contact_relationship",
  "health_insurance_provider", "health_insurance_policy_number",
  "health_insurance_expiry_date", "health_insurance_no_expiry",
  "passport_country", "passport_number", "passport_expiry_date",
  "visa_category", "visa_type", "visa_expiry_date",
];

// PATCH /api/users/[id] — admin edit of another user's profile (+ login email).
// super_admin / admin only. Uses the service-role client because RLS scopes
// profile writes to the caller's own row.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await hasAnyRole(supabase, user.id, ADMIN_ROLES))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  const updateData: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) updateData[key] = body[key];
  }

  const newEmail =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;

  if (Object.keys(updateData).length === 0 && !newEmail) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Same open-ended-policy rules as the self-service route: listed schemes
  // only, expiry cleared, annual confirmation clock stamped.
  const insuranceError = await normalizeInsuranceWrite(supabase, updateData, {
    provider: "health_insurance_provider",
    expiry: "health_insurance_expiry_date",
    flag: "health_insurance_no_expiry",
    confirmedAt: "health_insurance_confirmed_at",
  });
  if (insuranceError) {
    return NextResponse.json({ error: insuranceError }, { status: 400 });
  }

  // Department must be a real ministry slug (staff_ministries is the source of
  // truth, validated here since the static DB CHECK was dropped). Any existing
  // slug is accepted — active or retired.
  if ("department" in updateData && String(updateData.department ?? "").trim() !== "") {
    const { data: ministry } = await getMinistryBySlug(
      supabase,
      String(updateData.department)
    );
    if (!ministry) {
      return NextResponse.json(
        { error: "Please select a valid department." },
        { status: 400 }
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();

  // Email change — treated as an immediate, admin-initiated update (no
  // verification link, unlike the self-service flow in confirm-email). Update
  // the auth identity first, then mirror onto the app users row.
  if (newEmail) {
    const { data: current } = await admin
      .from("users")
      .select("email")
      .eq("id", id)
      .maybeSingle();

    if ((current?.email ?? "").toLowerCase() !== newEmail) {
      const { data: taken } = await admin
        .from("users")
        .select("id")
        .ilike("email", newEmail)
        .neq("id", id)
        .maybeSingle();
      if (taken) {
        return NextResponse.json(
          { error: "That email is already in use by another account." },
          { status: 409 }
        );
      }

      const { error: authErr } = await admin.auth.admin.updateUserById(id, {
        email: newEmail,
        email_confirm: true,
      });
      if (authErr) {
        return NextResponse.json(
          { error: "Couldn't update the login email. It may already be in use." },
          { status: 409 }
        );
      }

      await admin.from("users").update({ email: newEmail }).eq("id", id);

      await admin.from("audit_logs").insert({
        user_id: user.id,
        action: "email_changed",
        resource_type: "users",
        resource_id: id,
        changes: { to: newEmail },
      });
    }
  }

  if (Object.keys(updateData).length > 0) {
    const { error } = await admin.from("users").update(updateData).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "update",
      resource_type: "users",
      resource_id: id,
      changes: updateData,
    });
  }

  return NextResponse.json({ success: true });
}
