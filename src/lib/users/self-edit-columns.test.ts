import { describe, expect, it } from "vitest";
import {
  USER_ADMIN_CLIENT_COLUMNS,
  USER_SELF_EDIT_CHECKED_COLUMNS,
  USER_SELF_EDIT_COLUMNS,
  pickUserColumns,
  rejectedFieldsMessage,
} from "./self-edit-columns";

// Copied from the GRANT UPDATE list in migration 315
// (PR #544, head 3c109c3f). Order matches the SQL.
const GRANT_FREE = [
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "gender",
  "marital_status",
  "nationality",
  "phone",
  "address_line_1",
  "address_line_2",
  "city",
  "province",
  "country",
  "postal_code",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "health_insurance_provider",
  "health_insurance_policy_number",
  "health_insurance_expiry_date",
  "health_insurance_no_expiry",
  "health_insurance_confirmed_at",
  "next_health_insurance_provider",
  "next_health_insurance_policy_number",
  "next_health_insurance_expiry_date",
  "next_health_insurance_no_expiry",
  "passport_country",
  "passport_number",
  "passport_expiry_date",
  "visa_category",
  "visa_type",
  "visa_expiry_date",
  "is_international",
  "essence_statement",
  "has_children",
];

describe("315 column lists", () => {
  it("matches the 35 free columns, the 3 checked columns, and job_title", () => {
    expect([...USER_SELF_EDIT_COLUMNS]).toEqual(GRANT_FREE);
    expect([...USER_SELF_EDIT_CHECKED_COLUMNS]).toEqual([
      "department",
      "accepted_at",
      "status",
    ]);
    expect([...USER_ADMIN_CLIENT_COLUMNS]).toEqual(["job_title"]);
    const all = [
      ...USER_SELF_EDIT_COLUMNS,
      ...USER_SELF_EDIT_CHECKED_COLUMNS,
      ...USER_ADMIN_CLIENT_COLUMNS,
    ];
    expect(new Set(all).size).toBe(39);
  });
});

describe("pickUserColumns", () => {
  const allowed = [...USER_SELF_EDIT_COLUMNS, "department"];

  it("keeps allowlisted keys and names every other key", () => {
    const { picked, rejected } = pickUserColumns(
      {
        first_name: "Asha",
        department: "media",
        is_active: true,
        contact_id: "c1",
        email: "a@b.c",
        slack_user_id: "U1",
      },
      allowed
    );
    expect(picked).toEqual({ first_name: "Asha", department: "media" });
    expect(rejected).toEqual(["contact_id", "email", "is_active", "slack_user_id"]);
    expect(rejectedFieldsMessage(rejected)).toBe(
      "You can't change these fields: contact_id, email, is_active, slack_user_id."
    );
  });

  it("rejects job_title, status, and licence fields on the profile allowlist", () => {
    const { picked, rejected } = pickUserColumns(
      {
        phone: "082",
        job_title: "Lead",
        status: "active",
        drivers_licence_number: "1",
        base_driving_test_status: "passed",
        signup_type: "staff",
        household_id: "h1",
      },
      allowed
    );
    expect(picked).toEqual({ phone: "082" });
    expect(rejected).toEqual([
      "base_driving_test_status",
      "drivers_licence_number",
      "household_id",
      "job_title",
      "signup_type",
      "status",
    ]);
  });
});
