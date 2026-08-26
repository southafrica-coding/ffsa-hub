import { describe, it, expect } from "vitest";
import { isChildComplete, missingChildFields } from "./profile-fields";

const base = {
  full_name: "Jane Doe",
  date_of_birth: "2015-04-02",
  gender: "female",
  passport_country: "South Africa",
  passport_number: "A1234567",
  passport_expiry_date: "2030-01-01",
  health_insurance_provider: "Discovery",
  health_insurance_policy_number: "123456",
  health_insurance_expiry_date: "2027-01-01",
};

describe("missingChildFields", () => {
  it("is empty for a complete local child", () => {
    expect(missingChildFields(base)).toEqual([]);
    expect(isChildComplete(base)).toBe(true);
  });

  it("names the missing field without blaming the visa", () => {
    const missing = missingChildFields({
      ...base,
      gender: "",
      is_international: true,
      visa_category: "90_day",
    });
    expect(missing).toEqual(["Gender"]);
  });

  it("asks for long-term visa specifics only when long-term", () => {
    expect(
      missingChildFields({ ...base, is_international: true, visa_category: "long_term" })
    ).toEqual(["Visa Type", "Visa Expiry Date"]);
    expect(
      missingChildFields({ ...base, is_international: true, visa_category: "90_day" })
    ).toEqual([]);
  });

  it("rejects 'none' insurance once, not twice", () => {
    expect(missingChildFields({ ...base, health_insurance_provider: "none" })).toEqual([
      "Health Insurance Provider",
    ]);
  });
});
