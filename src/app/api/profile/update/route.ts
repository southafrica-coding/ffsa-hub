import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isExpiryDatePast } from "@/lib/users/profile-fields";
import { normalizeInsuranceWrite } from "@/lib/users/insurance-write";
import { getMinistryBySlug } from "@/services/ministries";
import { setHouseholdHasChildren } from "@/services/household";

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  // Only allow safe profile fields to be updated
  const allowedFields = [
    "first_name", "last_name", "date_of_birth",
    "gender", "marital_status", "nationality", "phone",
    "department",
    "address_line_1", "address_line_2", "city", "province",
    "country", "postal_code",
    "emergency_contact_name", "emergency_contact_phone",
    "emergency_contact_relationship",
    "health_insurance_provider", "health_insurance_policy_number",
    "health_insurance_expiry_date", "health_insurance_no_expiry",
    "passport_country", "passport_number", "passport_expiry_date",
    "visa_category", "visa_type", "visa_expiry_date",
  ];

  // Answer to "Do you have children?" (drives the staff children gate).
  // Since migration 181 this is a HOUSEHOLD fact, not a user one, so that a
  // spouse who links to an existing household inherits the answer instead of
  // being asked again. The request shape is unchanged — it's routed here.
  const hasChildrenGiven = "has_children" in body;
  const hasChildren =
    hasChildrenGiven && body.has_children != null
      ? Boolean(body.has_children)
      : null;

  const updateData: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      updateData[key] = body[key];
    }
  }

  if (Object.keys(updateData).length === 0 && !hasChildrenGiven) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
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

  // Department must be a real MAIN ministry slug (staff_ministries is the
  // source of truth, validated here rather than a static DB CHECK so
  // admin-added ministries save without a migration). Retired ministries are
  // still accepted so a user on a since-retired one isn't locked out;
  // part-time ministries are not — people join those through the roster, and
  // no picker offers them as a department.
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
    if ((ministry as { ministry_type?: string }).ministry_type === "part_time") {
      return NextResponse.json(
        {
          error:
            "That's a part-time ministry, so it can't be a department. Pick the main ministry they serve in — part-time ministries are joined from the Ministry tab.",
        },
        { status: 400 }
      );
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
