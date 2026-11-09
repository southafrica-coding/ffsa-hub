import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isExpiryDatePast } from "@/lib/users/profile-fields";
import { normalizeInsuranceWrite } from "@/lib/users/insurance-write";
import { getMinistryBySlug } from "@/services/ministries";
import { setHouseholdHasChildren } from "@/services/household";
import { normalizeMaritalStatus } from "@/lib/users/marital-status";
import {
  USER_SELF_EDIT_COLUMNS,
  pickUserColumns,
  rejectedFieldsMessage,
} from "@/lib/users/self-edit-columns";
import { readSelfActor, readUnscopedStaffRole } from "@/lib/users/self-edit-guard";
import { usersUpdateDeniedResponse } from "@/lib/users/users-update-error";
import {
  callerMayChooseDepartment,
  isDistinct,
  normalizeDepartment,
  verdictForDepartment,
} from "@/lib/users/self-department";

// PUT /api/profile/update — the caller's own profile, on the user client.
// Allowlist is the 34 free columns plus department (a checked column).
// has_children is not a users column we may write. When the body includes
// it, it is stored on households.has_children and left out of the users
// UPDATE. Anything else outside the allowlist is a 400 that names the
// fields. The users UPDATE is not called.

const PROFILE_COLUMNS = [...USER_SELF_EDIT_COLUMNS, "department"] as const;

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  // Household fact since migration 181. Pulled out before the users
  // allowlist so it is not rejected and is never copied onto public.users.
  const hasChildrenGiven = "has_children" in record;
  const hasChildren =
    hasChildrenGiven && record.has_children != null
      ? Boolean(record.has_children)
      : null;
  const usersInput = { ...record };
  delete usersInput.has_children;

  const { picked, rejected } = pickUserColumns(usersInput, PROFILE_COLUMNS);
  if (rejected.length > 0) {
    return NextResponse.json(
      { error: rejectedFieldsMessage(rejected) },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = { ...picked };
  if ("department" in updateData) {
    updateData.department = normalizeDepartment(updateData.department);
  }

  if (Object.keys(updateData).length === 0 && !hasChildrenGiven) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Marital status drives which family questions apply, so only the listed
  // values are accepted. Changing it never deletes family records an
  // existing member already has — they can remove a spouse themselves.
  if ("marital_status" in updateData) {
    const raw = updateData.marital_status;
    const status = normalizeMaritalStatus(raw);
    if (!status) {
      return NextResponse.json(
        { error: "Please choose a marital status from the list." },
        { status: 400 }
      );
    }
    updateData.marital_status = status;
  }

  // Health insurance must be valid and current — mirror the gate so the
  // block can't be dodged by POSTing a lapsed date or a "none" provider.
  if ("health_insurance_provider" in updateData) {
    const provider = String(updateData.health_insurance_provider ?? "").trim();
    if (provider === "" || provider.toLowerCase() === "none") {
      return NextResponse.json(
        { error: "Please select a valid health insurance provider." },
        { status: 400 }
      );
    }
  }
  // Open-ended scheme handling: validates the provider is a listed one,
  // clears the expiry date, and stamps the annual confirmation clock.
  const insuranceError = await normalizeInsuranceWrite(supabase, updateData, {
    provider: "health_insurance_provider",
    expiry: "health_insurance_expiry_date",
    flag: "health_insurance_no_expiry",
    confirmedAt: "health_insurance_confirmed_at",
  });
  if (insuranceError) {
    return NextResponse.json({ error: insuranceError }, { status: 400 });
  }
  if (
    "health_insurance_expiry_date" in updateData &&
    isExpiryDatePast(updateData.health_insurance_expiry_date)
  ) {
    return NextResponse.json(
      {
        error:
          "Your health insurance expiry date can't be in the past. Please enter the date your current policy expires.",
      },
      { status: 400 }
    );
  }

  const actor = await readSelfActor(supabase, user.id);
  if (!actor.ok) return actor.response;

  if (
    "department" in updateData &&
    isDistinct(updateData.department, normalizeDepartment(actor.row.department)) &&
    updateData.department != null
  ) {
    // signup_type = 'staff' is enough on its own (IS NOT DISTINCT FROM).
    // Only ask has_any_role when that isn't already true, and fail closed
    // if the check itself errors.
    let hasStaffRole = false;
    if (actor.row.signup_type !== "staff") {
      const role = await readUnscopedStaffRole(supabase);
      if (!role.ok) return role.response;
      hasStaffRole = role.hasRole;
    }
    const isStaff = callerMayChooseDepartment(actor.row.signup_type, hasStaffRole);
    let ministry: { slug: string; ministry_type?: string | null } | null = null;
    if (isStaff) {
      const { data } = await getMinistryBySlug(supabase, String(updateData.department));
      ministry = data as { slug: string; ministry_type?: string | null } | null;
    }
    const verdict = verdictForDepartment({
      value: updateData.department,
      isStaff,
      ministry,
    });
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    }
  }

  if (hasChildrenGiven) {
    const { error: householdError } = await setHouseholdHasChildren(
      supabase,
      user.id,
      hasChildren
    );
    if (householdError) {
      return NextResponse.json(
        { error: householdError.message },
        { status: 500 }
      );
    }
  }

  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", user.id);

    if (error) {
      const denied = usersUpdateDeniedResponse(error);
      if (denied) return denied;
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
