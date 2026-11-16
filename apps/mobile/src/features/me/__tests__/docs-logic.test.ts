import { makeMe } from "../../../../test/fixtures";
import {
  addableRelationships,
  confirmationDue,
  currentPolicyBody,
  currentPolicyId,
  deletablePolicyIds,
  formatDate,
  hasValidNext,
  INSURANCE_PROVIDERS,
  insuranceStatus,
  isAllowedSignedUrl,
  isPast,
  isPdfName,
  isStaff,
  joinProvider,
  memberBody,
  nextPolicyBody,
  providerAllowsNoExpiry,
  providerChoices,
  providerLabel,
  splitProvider,
  todayInSA,
  validateLicence,
  validateMember,
  validatePolicy,
  ymd,
  type MemberDraft,
  type PolicyRecord,
} from "../docs-logic";
import { meStrings } from "../strings";

const T = "2026-11-06";
const opts = INSURANCE_PROVIDERS;

describe("dates", () => {
  it("todayInSA is UTC+2 (late-evening UTC is already tomorrow in SA)", () => {
    expect(todayInSA(new Date("2026-11-06T21:59:00Z"))).toBe("2026-11-06");
    expect(todayInSA(new Date("2026-11-06T22:00:00Z"))).toBe("2026-11-07");
  });
  it("ymd / formatDate / isPast", () => {
    expect(ymd("2026-03-09T10:00:00Z")).toBe("2026-03-09");
    expect(ymd("nope")).toBe("");
    expect(ymd(null)).toBe("");
    expect(formatDate("2026-09-03")).toBe("3 Sep 2026");
    expect(formatDate(null)).toBe("");
    expect(isPast("2026-11-05", T)).toBe(true);
    expect(isPast("2026-11-06", T)).toBe(false);
    expect(isPast("", T)).toBe(false);
  });
});

describe("isStaff (web: showWorkTab)", () => {
  it("staff = any role beyond the membership floor", () => {
    expect(isStaff(makeMe({ roles: [{ name: "staff", scopeType: null, scopeId: null }] }))).toBe(true);
    expect(isStaff(makeMe({ roles: [{ name: "student", scopeType: null, scopeId: null }] }))).toBe(false);
    expect(
      isStaff(
        makeMe({
          roles: [
            { name: "community_member", scopeType: null, scopeId: null },
            { name: "self_service", scopeType: null, scopeId: null },
          ],
        }),
      ),
    ).toBe(false);
    expect(isStaff(makeMe({ roles: [] }))).toBe(false);
    expect(isStaff(null)).toBe(false);
  });
});

describe("insurance providers", () => {
  it("open-ended only for a listed scheme, never other/none/blank", () => {
    expect(providerAllowsNoExpiry("Discovery Health", opts)).toBe(true);
    expect(providerAllowsNoExpiry("discovery health ", opts)).toBe(true);
    expect(providerAllowsNoExpiry("other", opts)).toBe(false);
    expect(providerAllowsNoExpiry("none", opts)).toBe(false);
    expect(providerAllowsNoExpiry("My Small Insurer", opts)).toBe(false);
    expect(providerAllowsNoExpiry("", opts)).toBe(false);
  });
  it("split / join round-trip, off-list becomes Other + text", () => {
    expect(splitProvider("Bonitas", opts)).toEqual({ choice: "Bonitas", other: "" });
    expect(splitProvider("Acme Cover", opts)).toEqual({ choice: "other", other: "Acme Cover" });
    expect(splitProvider("none", opts)).toEqual({ choice: "", other: "" });
    expect(splitProvider(null, opts)).toEqual({ choice: "", other: "" });
    expect(joinProvider("other", " Acme ")).toBe("Acme");
    expect(joinProvider("Bonitas", "ignored")).toBe("Bonitas");
  });
  it("choices drop 'none' and always end with Other", () => {
    const c = providerChoices([
      { value: "none", label: "None" },
      { value: "GEMS", label: "GEMS" },
    ]);
    expect(c.map((o) => o.value)).toEqual(["GEMS", "other"]);
    expect(providerChoices([])).toEqual(INSURANCE_PROVIDERS);
    expect(providerLabel("GEMS", opts)).toBe("GEMS (Government Employees)");
    expect(providerLabel("Acme", opts)).toBe("Acme");
  });
});

describe("insurance status (web: getInsuranceStatus)", () => {
  it("ok / expiring (≤60 days) / expired / missing / open-ended", () => {
    expect(insuranceStatus({ expiryDate: "2027-06-01", noExpiry: false }, T).state).toBe("ok");
    expect(insuranceStatus({ expiryDate: "2026-12-01", noExpiry: false }, T)).toEqual({ state: "expiring", expiryDate: "2026-12-01", daysLeft: 25 });
    expect(insuranceStatus({ expiryDate: "2026-11-06", noExpiry: false }, T).state).toBe("expiring");
    expect(insuranceStatus({ expiryDate: "2026-11-05", noExpiry: false }, T).state).toBe("expired");
    expect(insuranceStatus({ expiryDate: null, noExpiry: false }, T).state).toBe("missing");
    expect(insuranceStatus({ expiryDate: "2020-01-01", noExpiry: true }, T).state).toBe("no_expiry");
  });
  it("yearly confirmation is due from 14 days before the anniversary, and when never confirmed", () => {
    expect(confirmationDue({ noExpiry: false, confirmedAt: null }, T)).toBe(false);
    expect(confirmationDue({ noExpiry: true, confirmedAt: null }, T)).toBe(true);
    expect(confirmationDue({ noExpiry: true, confirmedAt: "2026-06-01" }, T)).toBe(false);
    expect(confirmationDue({ noExpiry: true, confirmedAt: "2025-11-20" }, T)).toBe(true);
    expect(confirmationDue({ noExpiry: true, confirmedAt: "2025-11-21" }, T)).toBe(false);
  });
  it("a queued next policy counts only if it will take over", () => {
    expect(hasValidNext(null, T)).toBe(false);
    expect(hasValidNext({ provider: "Bonitas", expiryDate: "2027-01-01", noExpiry: false }, T)).toBe(true);
    expect(hasValidNext({ provider: "Bonitas", expiryDate: "2026-01-01", noExpiry: false }, T)).toBe(false);
    expect(hasValidNext({ provider: "Bonitas", expiryDate: null, noExpiry: true }, T)).toBe(true);
    expect(hasValidNext({ provider: "none", expiryDate: "2027-01-01", noExpiry: false }, T)).toBe(false);
  });
});

describe("policy history (web: insurance-policies.ts)", () => {
  const row = (id: string, policyNumber: string | null, expiryDate: string | null, noExpiry = false): PolicyRecord => ({
    id,
    provider: "Bonitas",
    policyNumber,
    expiryDate,
    noExpiry,
    recordedAt: `2026-0${id}-01T00:00:00Z`,
  });
  const rows = [row("3", "A1", "2027-01-01"), row("2", "A1", "2026-01-01"), row("1", "B2", "2025-01-01")];
  const current = { provider: "Bonitas", policyNumber: "A1", expiryDate: "2027-01-01", noExpiry: false, confirmedAt: null };

  it("current = the row matching the live values, else the newest", () => {
    expect(currentPolicyId(rows, current)).toBe("3");
    expect(currentPolicyId(rows, { ...current, policyNumber: "ZZ" })).toBe("3");
    expect(currentPolicyId([], current)).toBeNull();
    // an open-ended row and a dated one are different policies
    expect(currentPolicyId([row("5", "A1", "2027-01-01", true), ...rows], current)).toBe("3");
  });
  it("only non-current duplicates are deletable", () => {
    expect([...deletablePolicyIds(rows, "3")]).toEqual(["2"]);
    expect([...deletablePolicyIds([row("1", "A1", "2026-01-01")], "1")]).toEqual([]);
  });
});

describe("policy forms", () => {
  const e = meStrings.docs.insurance.errors;
  const base = { choice: "Bonitas", other: "", policyNumber: " 123 ", expiry: "2027-02-01", noExpiry: false };

  it("validates provider, other text, expiry and the next-after-current rule", () => {
    expect(validatePolicy(base, opts, e, { today: T })).toEqual({});
    expect(validatePolicy({ ...base, choice: "" }, opts, e, { today: T }).provider).toBe(e.providerRequired);
    expect(validatePolicy({ ...base, choice: "other" }, opts, e, { today: T }).other).toBe(e.otherRequired);
    expect(validatePolicy({ ...base, expiry: "" }, opts, e, { today: T }).expiry).toBe(e.expiryRequired);
    expect(validatePolicy({ ...base, expiry: "2026-01-01" }, opts, e, { today: T }).expiry).toBe(e.expiryPast);
    expect(validatePolicy(base, opts, e, { today: T, mustFollow: "2027-02-01" }).expiry).toBe(e.nextAfterCurrent);
    // open-ended needs no date…
    expect(validatePolicy({ ...base, expiry: "", noExpiry: true }, opts, e, { today: T })).toEqual({});
    // …but only for a listed scheme
    expect(validatePolicy({ ...base, choice: "other", other: "Acme", expiry: "", noExpiry: true }, opts, e, { today: T }).expiry).toBe(
      e.expiryRequired,
    );
  });

  it("builds the same bodies the web sends", () => {
    expect(currentPolicyBody(base, opts)).toEqual({
      health_insurance_provider: "Bonitas",
      health_insurance_policy_number: "123",
      health_insurance_expiry_date: "2027-02-01",
      health_insurance_no_expiry: false,
    });
    expect(currentPolicyBody({ ...base, noExpiry: true }, opts)).toMatchObject({ health_insurance_expiry_date: null, health_insurance_no_expiry: true });
    // an Other provider can never be open-ended
    expect(currentPolicyBody({ ...base, choice: "other", other: "Acme", noExpiry: true }, opts)).toMatchObject({
      health_insurance_provider: "Acme",
      health_insurance_no_expiry: false,
    });
    expect(nextPolicyBody({ ...base, policyNumber: "" }, opts)).toEqual({
      provider: "Bonitas",
      policy_number: null,
      expiry_date: "2027-02-01",
      no_expiry: false,
    });
  });
});

describe("licence", () => {
  it("needs a number and an expiry date", () => {
    const e = meStrings.docs.licence.errors;
    expect(validateLicence({ number: "X1", country: "ZA", code: "B", expiry: "2028-01-01" }, e)).toEqual({});
    expect(validateLicence({ number: " ", country: "ZA", code: "", expiry: "" }, e)).toEqual({
      number: e.numberRequired,
      expiry: e.expiryRequired,
    });
  });
});

describe("household", () => {
  it("no spouse button unless married or status unknown (web: addableRelationships)", () => {
    expect(addableRelationships("married")).toEqual(["spouse", "child"]);
    expect(addableRelationships(null)).toEqual(["spouse", "child"]);
    expect(addableRelationships("Single")).toEqual(["child"]);
    expect(addableRelationships("widowed")).toEqual(["child"]);
    expect(addableRelationships("divorced")).toEqual(["child"]);
  });

  const child: MemberDraft = {
    relationship: "child",
    firstName: "",
    lastName: "",
    email: "",
    fullName: " Sample Person ",
    dateOfBirth: "2018-04-01",
    gender: "male",
    passportCountry: "South Africa",
    passportNumber: " A123 ",
    passportExpiry: "2030-01-01",
    isInternational: false,
    visaCategory: "long_term",
    visaType: "Study",
    visaExpiry: "2027-01-01",
    insuranceChoice: "Bonitas",
    insuranceOther: "",
    policyNumber: "P1",
    insuranceExpiry: "2027-03-01",
    noExpiry: false,
  };

  it("validates a spouse (name + email) and a child (full name)", () => {
    const e = meStrings.docs.member.errors;
    expect(validateMember(child, e)).toEqual({});
    expect(validateMember({ ...child, fullName: "" }, e)).toEqual({ fullName: e.fullName });
    const spouse = { ...child, relationship: "spouse", firstName: "Sample", lastName: "Person", email: "sample@example.org" };
    expect(validateMember(spouse, e)).toEqual({});
    expect(validateMember({ ...spouse, email: "not-an-email" }, e)).toEqual({ email: e.emailInvalid });
    expect(validateMember({ ...spouse, firstName: "", lastName: "", email: "" }, e)).toEqual({
      firstName: e.spouseFirst,
      lastName: e.spouseLast,
      email: e.spouseEmail,
    });
  });

  it("a spouse sends name + email only, with visa cleared", () => {
    const body = memberBody({ ...child, relationship: "spouse", firstName: " Sample ", lastName: "Person", email: "sample@example.org" }, opts);
    expect(body).toEqual({
      relationship: "spouse",
      first_name: "Sample",
      last_name: "Person",
      email: "sample@example.org",
      full_name: "Sample Person",
      is_international: false,
      visa_category: "",
      visa_type: "",
      visa_expiry_date: "",
    });
    expect(body).not.toHaveProperty("passport_number");
  });

  it("a child's visa is cleared unless international, and the specifics unless long-term", () => {
    const local = memberBody(child, opts);
    expect(local).toMatchObject({ full_name: "Sample Person", passport_number: "A123", visa_category: "", visa_type: "", visa_expiry_date: "" });
    const intl = memberBody({ ...child, isInternational: true }, opts);
    expect(intl).toMatchObject({ is_international: true, visa_category: "long_term", visa_type: "Study", visa_expiry_date: "2027-01-01" });
    const shortStay = memberBody({ ...child, isInternational: true, visaCategory: "90_day" }, opts);
    expect(shortStay).toMatchObject({ visa_category: "90_day", visa_type: "", visa_expiry_date: "" });
    const open = memberBody({ ...child, noExpiry: true }, opts);
    expect(open).toMatchObject({ health_insurance_no_expiry: true, health_insurance_expiry_date: "" });
  });
});

describe("files", () => {
  it("knows a PDF by its stored name", () => {
    expect(isPdfName("licence.PDF")).toBe(true);
    expect(isPdfName("licence.jpg")).toBe(false);
    expect(isPdfName(null)).toBe(false);
  });
  it("opens only signed links to this app's Supabase storage", () => {
    const sb = "https://abc.supabase.co";
    expect(isAllowedSignedUrl("https://abc.supabase.co/storage/v1/object/sign/vehicle-inspections/x.jpg?token=t", sb)).toBe(true);
    expect(isAllowedSignedUrl("http://abc.supabase.co/storage/v1/object/sign/x", sb)).toBe(false);
    expect(isAllowedSignedUrl("https://evil.example/storage/v1/object/sign/x", sb)).toBe(false);
    expect(isAllowedSignedUrl("https://abc.supabase.co/storage/v1/object/public/x", sb)).toBe(false);
    expect(isAllowedSignedUrl(null, sb)).toBe(false);
    expect(isAllowedSignedUrl("not a url", sb)).toBe(false);
  });
});
