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
import { readSelfActor } from "@/lib/users/self-edit-guard";
import { usersUpdateDeniedResponse } from "@/lib/users/users-update-error";
import {
  callerMayChooseDepartment,
  isBlankDepartment,
  isDistinct,
  verdictForDepartment,
} from "@/lib/users/self-department";

// PUT /api/profile/update — the caller's own profile, on the user client.
// Allowlist is the 35 free columns plus department (a checked column).
// has_children is in the 35 but is stored on households, not written here.
// Anything else in the body is a 400 that names the fields. The UPDATE is
// not called.

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

  const { picked, rejected } = pickUserColumns(
    body as Record<string, unknown>,
    PROFILE_COLUMNS
  );
  if (rejected.length > 0) {
    return NextResponse.json(
      { error: rejectedFieldsMessage(rejected) },
      { status: 400 }
    );
  }

  // Answer to "Do you have children?" (drives the staff children gate).
  // Since migration 181 this is a HOUSEHOLD fact, not a user one, so that a
  // spouse who links to an existing household inherits the answer instead of
  // being asked again. The request shape is unchanged — it's routed here,
  // and users.has_children (still granted by 315) is left untouched.
  const hasChildrenGiven = "has_children" in picked;
  const hasChildren =
    hasChildrenGiven && picked.has_children != null
      ? Boolean(picked.has_children)
      : null;

  const updateData: Record<string, unknown> = {};
  for (const key of Object.keys(picked)) {
    if (key === "has_children") continue;
    updateData[key] = picked[key];
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
    isDistinct(updateData.department, actor.row.department) &&
    !isBlankDepartment(updateData.department)
  ) {
    // signup_type = 'staff' is enough on its own (IS NOT DISTINCT FROM).
    // Only ask has_any_role when that isn't already true, and fail closed
    // if the check itself errors.
    let hasStaffRole = false;
    if (actor.row.signup_type !== "staff") {
      const { data, error: roleError } = await supabase.rpc("has_any_role", {
        required_roles: ["staff"],
      });
      if (roleError) {
        return NextResponse.json(
          { error: "Couldn't verify department access." },
          { status: 500 }
        );
      }
      hasStaffRole = data === true;
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
