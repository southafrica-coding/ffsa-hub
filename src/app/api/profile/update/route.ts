import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isExpiryDatePast } from "@/lib/users/profile-fields";

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
    "first_name", "last_name", "preferred_name", "date_of_birth",
    "gender", "marital_status", "nationality", "phone",
    "department",
    "address_line_1", "address_line_2", "city", "province",
    "country", "postal_code",
    "emergency_contact_name", "emergency_contact_phone",
    "emergency_contact_relationship",
    "health_insurance_provider", "health_insurance_policy_number",
    "health_insurance_expiry_date",
    "passport_country", "passport_number",
    "visa_category", "visa_type", "visa_expiry_date",
  ];

  const updateData: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      updateData[key] = body[key];
    }
  }

  if (Object.keys(updateData).length === 0) {
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

  const { error } = await supabase
    .from("users")
    .update(updateData)
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
