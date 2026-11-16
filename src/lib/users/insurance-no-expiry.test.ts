import { describe, it, expect } from "vitest";
import {
  getInsuranceStatus,
  getInsuranceConfirmation,
  getMissingProfileFields,
  getProfileBlock,
  hasValidQueuedPolicy,
  isChildComplete,
  missingChildFields,
  INSURANCE_CONFIRM_INTERVAL_DAYS,
} from "./profile-fields";
import { providerAllowsNoExpiry } from "@/lib/profile/options";

const TODAY = "2026-09-09";

// Shift a YYYY-MM-DD by whole days.
const shift = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe("getInsuranceStatus with an open-ended policy", () => {
  it("reads as no_expiry, never missing", () => {
    const status = getInsuranceStatus(
      {
        health_insurance_no_expiry: true,
        health_insurance_expiry_date: null,
      },
      TODAY
    );
    expect(status).toEqual({
      state: "no_expiry",
      expiryDate: null,
      daysLeft: null,
    });
  });

  it("wins over a stale date, so it can never read as expired", () => {
    const status = getInsuranceStatus(
      {
        health_insurance_no_expiry: true,
        health_insurance_expiry_date: "2020-01-01",
      },
      TODAY
    );
    expect(status.state).toBe("no_expiry");
  });

  it("leaves a dated policy alone", () => {
    expect(
      getInsuranceStatus(
        { health_insurance_expiry_date: "2020-01-01" },
        TODAY
      ).state
    ).toBe("expired");
  });
});

describe("providerAllowsNoExpiry", () => {
  it("accepts a listed SA scheme", () => {
    expect(providerAllowsNoExpiry("Discovery Health")).toBe(true);
    expect(providerAllowsNoExpiry("GEMS")).toBe(true);
  });

  it("rejects the Other sentinel, a blank, the legacy none, and off-list text", () => {
    expect(providerAllowsNoExpiry("other")).toBe(false);
    expect(providerAllowsNoExpiry("")).toBe(false);
    expect(providerAllowsNoExpiry("none")).toBe(false);
    expect(providerAllowsNoExpiry("Kaiser Permanente")).toBe(false);
    expect(providerAllowsNoExpiry(null)).toBe(false);
  });

  it("accepts a scheme an admin added to list_options but not the constant", () => {
    const live = [{ value: "Sizwe Hosmed" }, { value: "Thebemed" }, { value: "other" }];
    expect(providerAllowsNoExpiry("Thebemed", live)).toBe(true);
    // …and still refuses "other" from that same live list.
    expect(providerAllowsNoExpiry("other", live)).toBe(false);
  });
});

describe("getInsuranceConfirmation", () => {
  const at = (daysAgo: number) => ({
    health_insurance_no_expiry: true,
    health_insurance_confirmed_at: shift(TODAY, -daysAgo),
  });

  it("is irrelevant for a dated policy", () => {
    expect(
      getInsuranceConfirmation(
        { health_insurance_expiry_date: "2027-01-01" },
        TODAY
      ).level
    ).toBe("current");
  });

  it("walks current → due_soon → due → blocking", () => {
    expect(getInsuranceConfirmation(at(300), TODAY).level).toBe("current");
    expect(getInsuranceConfirmation(at(355), TODAY).level).toBe("due_soon");
    expect(getInsuranceConfirmation(at(366), TODAY).level).toBe("due");
    expect(getInsuranceConfirmation(at(400), TODAY).level).toBe("due");
    expect(getInsuranceConfirmation(at(430), TODAY).level).toBe("blocking");
  });

  it("reports the due date one interval after the confirmation", () => {
    const c = getInsuranceConfirmation(at(0), TODAY);
    expect(c.dueOn).toBe(shift(TODAY, INSURANCE_CONFIRM_INTERVAL_DAYS));
    expect(c.daysUntilDue).toBe(INSURANCE_CONFIRM_INTERVAL_DAYS);
  });

  it("treats a missing confirmation as due but NEVER blocking", () => {
    const c = getInsuranceConfirmation(
      { health_insurance_no_expiry: true, health_insurance_confirmed_at: null },
      TODAY
    );
    expect(c.level).toBe("due");
    expect(c.confirmedAt).toBeNull();
  });
});

describe("the gate", () => {
  // Every required field except the insurance expiry date.
  const complete: Record<string, unknown> = {
    first_name: "Sam",
    last_name: "Person 202",
    gender: "male",
    marital_status: "single",
    date_of_birth: "1995-01-01",
    nationality: "South Africa",
    department: "media",
    phone: "+27821234567",
    country: "South Africa",
    address_line_1: "1 Main Rd",
    city: "Potchefstroom",
    province: "North West",
    postal_code: "2520",
    emergency_contact_name: "Ada",
    emergency_contact_phone: "+27821234568",
    emergency_contact_relationship: "parent",
    health_insurance_provider: "Discovery Health",
    health_insurance_policy_number: "123456",
    passport_country: "South Africa",
    passport_number: "A1234567",
    passport_expiry_date: "2030-01-01",
  };

  it("stops asking for an expiry date once the policy is open-ended", () => {
    expect(
      getMissingProfileFields(complete).map((f) => f.field)
    ).toContain("health_insurance_expiry_date");
    expect(
      getMissingProfileFields({
        ...complete,
        health_insurance_no_expiry: true,
      }).map((f) => f.field)
    ).not.toContain("health_insurance_expiry_date");
  });

  it("lets a confirmed open-ended policy through", () => {
    expect(
      getProfileBlock({
        ...complete,
        health_insurance_no_expiry: true,
        health_insurance_confirmed_at: TODAY,
      })
    ).toBeNull();
  });

  it("blocks one that is long overdue its annual confirmation", () => {
    const block = getProfileBlock({
      ...complete,
      health_insurance_no_expiry: true,
      health_insurance_confirmed_at: "2020-01-01",
    });
    expect(block?.reason).toBe("insurance_unconfirmed");
  });
});

describe("hasValidQueuedPolicy", () => {
  it("accepts an open-ended successor with no date", () => {
    expect(
      hasValidQueuedPolicy(
        {
          next_health_insurance_provider: "Bonitas",
          next_health_insurance_no_expiry: true,
          next_health_insurance_expiry_date: null,
        },
        TODAY
      )
    ).toBe(true);
  });
});

describe("children gate", () => {
  const child = {
    full_name: "Jane Doe",
    date_of_birth: "2015-04-02",
    gender: "female",
    passport_country: "South Africa",
    passport_number: "A1234567",
    passport_expiry_date: "2030-01-01",
    health_insurance_provider: "Bonitas",
    health_insurance_policy_number: "123456",
  };

  it("still demands an expiry date for a dated policy", () => {
    expect(missingChildFields(child)).toEqual([
      "Health Insurance Expiry Date",
    ]);
  });

  it("accepts a child on an open-ended scheme", () => {
    expect(
      isChildComplete({ ...child, health_insurance_no_expiry: true })
    ).toBe(true);
  });
});
