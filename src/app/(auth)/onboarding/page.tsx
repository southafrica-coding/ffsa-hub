"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateUserProfile, completeOnboarding } from "@/services/users";
import { isExpiryDatePast } from "@/lib/users/profile-fields";
import { validatePassword } from "@/lib/auth/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { HouseholdMembers } from "@/components/profile/household-members";
import { REQUIRED_CONSENTS } from "@/services/consent";
import {
  COUNTRY_OPTIONS,
  SA_PROVINCES,
  GENDER_OPTIONS,
  RELATIONSHIP_OPTIONS,
  INSURANCE_PROVIDERS,
} from "@/lib/profile/options";
import Image from "next/image";

// Ordered step definitions. Which steps are shown depends on the user's
// signup type — community members skip the Passport & Visa step (that's
// staff/international-traveller data). `num` is the stable identity used by
// the per-step JSX blocks; the visible position/total are derived from the
// active subset at render time.
type StepKey = "password" | "personal" | "address" | "passport" | "emergency" | "family" | "consent";

const STEP_DEFS: { num: number; key: StepKey; label: string }[] = [
  { num: 1, key: "password", label: "Password" },
  { num: 2, key: "personal", label: "Personal" },
  { num: 3, key: "address", label: "Address" },
  { num: 4, key: "passport", label: "Passport" },
  { num: 5, key: "emergency", label: "Emergency" },
  { num: 6, key: "family", label: "Family" },
  { num: 7, key: "consent", label: "Consent" },
];

interface FormData {
  first_name: string;
  last_name: string;
  preferred_name: string;
  date_of_birth: string;
  gender: string;
  marital_status: string;
  nationality: string;
  phone: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  province: string;
  country: string;
  postal_code: string;
  is_international: boolean;
  passport_country: string;
  passport_number: string;
  passport_expiry_date: string;
  visa_category: string;
  visa_type: string;
  visa_expiry_date: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  health_insurance_provider: string;
  health_insurance_policy_number: string;
  health_insurance_expiry_date: string;
}

const EMPTY_FORM: FormData = {
  first_name: "", last_name: "", preferred_name: "",
  date_of_birth: "", gender: "", marital_status: "",
  nationality: "", phone: "",
  address_line_1: "", address_line_2: "", city: "",
  province: "", country: "", postal_code: "",
  is_international: false, passport_country: "South Africa", passport_number: "", passport_expiry_date: "",
  visa_category: "", visa_type: "", visa_expiry_date: "",
  emergency_contact_name: "", emergency_contact_phone: "",
  emergency_contact_relationship: "", health_insurance_provider: "",
  health_insurance_policy_number: "", health_insurance_expiry_date: "",
};

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSet, setPasswordSet] = useState(false);
  // Required policy agreements for this signup type (privacy + child protection
  // for everyone; + NDA for staff). Each must be ticked to finish.
  const [requiredAgreements, setRequiredAgreements] = useState<
    { kind: string; version: string; title: string }[]
  >([]);
  const [consentChecked, setConsentChecked] = useState<Record<string, boolean>>({});
  const [programName, setProgramName] = useState<string | null>(null);
  const [signupType, setSignupType] = useState<string | null>(null);

  // Editable dropdown lists (admin-managed in Settings). Start from the
  // bundled defaults and overwrite once the DB copy loads, so the form works
  // even if the fetch is slow or the table is empty.
  const [genderOpts, setGenderOpts] = useState(GENDER_OPTIONS);
  const [relationshipOpts, setRelationshipOpts] = useState(RELATIONSHIP_OPTIONS);
  const [insuranceOpts, setInsuranceOpts] = useState(INSURANCE_PROVIDERS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          "/api/list-options?keys=gender,relationship,insurance_provider"
        );
        if (!res.ok) return;
        const { lists } = await res.json();
        if (cancelled || !lists) return;
        if (lists.gender?.length) setGenderOpts(lists.gender);
        if (lists.relationship?.length) setRelationshipOpts(lists.relationship);
        if (lists.insurance_provider?.length)
          setInsuranceOpts(lists.insurance_provider);
      } catch {
        // Keep the bundled defaults on any failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Users arriving from /join/[code] already set a password during signup,
    // so skip the password step entirely.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("welcome") === "1") {
        setPasswordSet(true);
        setStep(2);
      }
    }
    async function loadUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { router.push("/login"); return; }
      setUserId(authUser.id);

      const { data: appUser } = await (supabase as any)
        .from("users").select("*").eq("id", authUser.id).single();
      if (!appUser) { router.push("/login"); return; }

      if (appUser.accepted_at) {
        const { data: roles } = await (supabase as any)
          .from("user_roles").select("roles(name)").eq("user_id", authUser.id);
        const adminRoles = ["super_admin","admin","events_admin","program_leader","team_leader","staff","finance_admin","comms_admin","mission_leader"];
        const roleNames = (roles ?? []).flatMap((r: any) =>
          Array.isArray(r.roles) ? r.roles.map((x: any) => x.name) : r.roles ? [r.roles.name] : []
        );
        router.push(roleNames.some((r: string) => adminRoles.includes(r)) ? "/dashboard" : "/profile");
        return;
      }

      setForm({
        first_name: appUser.first_name ?? "", last_name: appUser.last_name ?? "",
        preferred_name: appUser.preferred_name ?? "", date_of_birth: appUser.date_of_birth ?? "",
        gender: appUser.gender ?? "", marital_status: appUser.marital_status ?? "",
        nationality: appUser.nationality ?? "", phone: appUser.phone ?? "",
        address_line_1: appUser.address_line_1 ?? "", address_line_2: appUser.address_line_2 ?? "",
        city: appUser.city ?? "", province: appUser.province ?? "",
        country: appUser.country ?? "", postal_code: appUser.postal_code ?? "",
        is_international: appUser.is_international ?? false,
        passport_country: appUser.passport_country ?? "South Africa", passport_number: appUser.passport_number ?? "",
        passport_expiry_date: appUser.passport_expiry_date ?? "",
        visa_category: appUser.visa_category ?? "", visa_type: appUser.visa_type ?? "",
        visa_expiry_date: appUser.visa_expiry_date ?? "",
        emergency_contact_name: appUser.emergency_contact_name ?? "",
        emergency_contact_phone: appUser.emergency_contact_phone ?? "",
        emergency_contact_relationship: appUser.emergency_contact_relationship ?? "",
        health_insurance_provider: appUser.health_insurance_provider ?? "",
        health_insurance_policy_number: appUser.health_insurance_policy_number ?? "",
        health_insurance_expiry_date: appUser.health_insurance_expiry_date ?? "",
      });
      setSignupType(appUser.signup_type ?? null);

      // Fetch every policy this signup type must accept (privacy + child
      // protection for all; + NDA for staff). We record each at finish.
      try {
        const isStaffSignup = appUser.signup_type === "staff";
        const kinds = REQUIRED_CONSENTS.filter(
          (r) => r.audience === "all" || (r.audience === "staff" && isStaffSignup)
        ).map((r) => r.kind);
        const fetched: { kind: string; version: string; title: string }[] = [];
        for (const kind of kinds) {
          const res = await fetch(`/api/consent?kind=${kind}`);
          if (!res.ok) continue;
          const { agreement } = await res.json();
          if (agreement?.version) {
            fetched.push({
              kind,
              version: agreement.version,
              title: agreement.title,
            });
          }
        }
        setRequiredAgreements(fetched);
      } catch {
        // Non-fatal; the consent step will display an error if none loaded.
      }

      // If they arrived via an accepted application, an enrollment was created
      // at accept-time. Surface which program they were accepted into so the
      // school link is visible while they build their profile.
      try {
        const { data: enr } = await (supabase as any)
          .from("enrollments")
          .select("programs(name)")
          .eq("user_id", authUser.id)
          .order("enrolled_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const prog = Array.isArray(enr?.programs) ? enr.programs[0] : enr?.programs;
        if (prog?.name) setProgramName(prog.name);
      } catch {
        // Non-fatal; onboarding works fine without the program banner.
      }

      setLoading(false);
    }
    loadUser();
  }, []);

  function set(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }
  function nullify(val: string) { return val.trim() === "" ? null : val.trim(); }

  // Per-step validation. Returns an error message if the step is incomplete,
  // or null if all required fields for the step are filled. Keep this in sync
  // with the `*` markers in the JSX below.
  function validateStep(s: number): string | null {
    const blank = (v: string) => !v || !v.trim();
    if (s === 2) {
      if (blank(form.first_name)) return "First name is required.";
      if (blank(form.last_name)) return "Last name is required.";
      if (blank(form.date_of_birth)) return "Date of birth is required.";
      if (blank(form.gender)) return "Gender is required.";
      if (blank(form.marital_status)) return "Marital status is required.";
      if (blank(form.nationality)) return "Nationality is required.";
      if (blank(form.phone)) return "Phone number is required.";
      return null;
    }
    if (s === 3) {
      if (blank(form.address_line_1)) return "Address line 1 is required.";
      if (blank(form.city)) return "City is required.";
      if (!hideProvince && blank(form.province)) return "Province / state is required.";
      if (blank(form.country)) return "Country is required.";
      if (blank(form.postal_code)) return "Postal code is required.";
      return null;
    }
    if (s === 4) {
      // Passport is required for everyone, South African or not.
      if (blank(form.passport_country)) return "Passport country is required.";
      if (blank(form.passport_number)) return "Passport number is required.";
      if (blank(form.passport_expiry_date)) return "Passport expiry date is required.";
      // Visa details are only collected for international staff.
      if (!form.is_international) return null;
      if (blank(form.visa_category)) return "Please select a visa status.";
      if (form.visa_category === "long_term") {
        if (blank(form.visa_type)) return "Visa type is required.";
        if (blank(form.visa_expiry_date)) return "Visa expiry date is required.";
      }
      return null;
    }
    if (s === 5) {
      if (blank(form.emergency_contact_name)) return "Emergency contact name is required.";
      if (blank(form.emergency_contact_phone)) return "Emergency contact phone is required.";
      if (blank(form.emergency_contact_relationship)) return "Emergency contact relationship is required.";
      // Health-insurance is a staff/student benefit field — optional for
      // community members.
      if (signupType !== "community") {
        if (blank(form.health_insurance_provider)) return "Health insurance provider is required.";
        if (blank(form.health_insurance_policy_number)) return "Health insurance policy number is required.";
        if (blank(form.health_insurance_expiry_date)) return "Health insurance expiry date is required.";
        if (isExpiryDatePast(form.health_insurance_expiry_date))
          return "Your health insurance has expired. Please enter the date your current policy expires.";
      }
      return null;
    }
    return null;
  }

  async function handleFinish() {
    if (!userId) return;
    if (requiredAgreements.length === 0) {
      setError("Unable to load the required agreements. Please refresh and try again.");
      return;
    }
    if (!requiredAgreements.every((a) => consentChecked[a.kind])) {
      setError("You must read and agree to every policy to complete onboarding.");
      return;
    }
    setSaving(true); setError(null);
    try {
      for (const agreement of requiredAgreements) {
        const consentRes = await fetch("/api/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: agreement.kind,
            agreement_version: agreement.version,
            source: "onboarding",
          }),
        });
        if (!consentRes.ok) {
          const result = await consentRes.json().catch(() => ({}));
          throw new Error(result.error ?? `Failed to record consent for ${agreement.title}`);
        }
      }

      const { error: profileError } = await updateUserProfile(supabase, userId, {
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        preferred_name: nullify(form.preferred_name), date_of_birth: nullify(form.date_of_birth),
        gender: nullify(form.gender), marital_status: nullify(form.marital_status),
        nationality: nullify(form.nationality), phone: nullify(form.phone),
        address_line_1: nullify(form.address_line_1), address_line_2: nullify(form.address_line_2),
        city: nullify(form.city), province: nullify(form.province),
        country: nullify(form.country), postal_code: nullify(form.postal_code),
        is_international: form.is_international,
        passport_country: nullify(form.passport_country),
        passport_number: nullify(form.passport_number),
        passport_expiry_date: nullify(form.passport_expiry_date),
        visa_category: form.is_international ? nullify(form.visa_category) : null,
        visa_type: form.is_international && form.visa_category === "long_term" ? nullify(form.visa_type) : null,
        visa_expiry_date: form.is_international && form.visa_category === "long_term" ? nullify(form.visa_expiry_date) : null,
        emergency_contact_name: nullify(form.emergency_contact_name),
        emergency_contact_phone: nullify(form.emergency_contact_phone),
        emergency_contact_relationship: nullify(form.emergency_contact_relationship),
        health_insurance_provider: nullify(form.health_insurance_provider),
        health_insurance_policy_number: nullify(form.health_insurance_policy_number),
        health_insurance_expiry_date: nullify(form.health_insurance_expiry_date),
      });
      if (profileError) throw new Error(profileError.message);
      await completeOnboarding(supabase, userId);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--surface-2)" }}>
        <p style={{ color: "var(--text-tertiary)", letterSpacing: "0.2em", fontSize: "11px", textTransform: "uppercase" }}>
          Loading…
        </p>
      </div>
    );
  }

  // The active steps for this user. Community members skip the Passport step.
  const isCommunity = signupType === "community";
  // Province isn't collected for the self-signup membership types.
  const hideProvince =
    signupType === "staff" || signupType === "student" || signupType === "community";
  const activeSteps = STEP_DEFS.filter((d) => !(isCommunity && d.key === "passport"));
  const activeNums = activeSteps.map((d) => d.num);
  const currentPos = Math.max(0, activeNums.indexOf(step));
  const totalSteps = activeSteps.length;
  const isLastStep = step === activeNums[activeNums.length - 1];
  const nextStep = () => activeNums[Math.min(currentPos + 1, activeNums.length - 1)];
  const prevStep = () => activeNums[Math.max(currentPos - 1, 0)];
  const progress = ((currentPos + 1) / totalSteps) * 100;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--surface-2)" }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-8 py-5"
        style={{ borderBottom: "1px solid var(--rule)" }}
      >
        <div className="flex items-center gap-3">
          <Image src="/brand/ff-wordmark-black.png" alt="Fire & Fragrance" width={140} height={17} style={{ objectFit: "contain", display: "block" }} priority />
          <div style={{ height: "1px", width: "12px", background: "var(--yellow)" }} />
          <span style={{ fontSize: "8px", letterSpacing: "0.3em", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" }}>
            Hub
          </span>
        </div>
        <p style={{ fontSize: "10px", letterSpacing: "0.2em", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
          Account Setup
        </p>
      </div>

      {/* Step indicator */}
      <div style={{ borderBottom: "1px solid var(--rule)" }}>
        <div className="flex">
          {activeSteps.map((def, i) => {
            const label = def.label;
            const isDone = currentPos > i;
            const isActive = step === def.num;
            return (
              <div
                key={label}
                className="flex-1 flex flex-col items-center py-3 gap-1"
                style={{
                  borderBottom: isActive ? `2px solid var(--yellow)` : isDone ? `2px solid hsl(42 95% 55% / 0.35)` : `2px solid transparent`,
                }}
              >
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: "0.2em",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: isActive ? "var(--text-primary)" : isDone ? "var(--text-secondary)" : "var(--text-tertiary)",
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        {/* Thin yellow progress fill */}
        <div style={{ height: "1px", background: "var(--surface-3)", position: "relative" }}>
          <div
            style={{
              position: "absolute", top: 0, left: 0, height: "100%",
              width: `${progress}%`,
              background: "var(--yellow)",
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-lg">

          {/* Acceptance context — only shown when an enrollment already exists
              (i.e. they came in via an accepted application). */}
          {programName && (
            <div
              style={{
                marginBottom: "1rem",
                padding: "0.875rem 1.25rem",
                borderRadius: "0",
                background: "var(--yellow-dim)",
                border: "1px solid var(--yellow-border)",
              }}
            >
              <p style={{ fontSize: "9px", letterSpacing: "0.2em", fontWeight: 700, textTransform: "uppercase", color: "var(--text-primary)", marginBottom: "3px" }}>
                You&rsquo;ve been accepted
              </p>
              <p style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.4 }}>
                Finish setting up your profile to join{" "}
                <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{programName}</strong>.
              </p>
            </div>
          )}

          {/* Step card */}
          <div
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--rule)",
              borderRadius: "0",
              overflow: "hidden",
            }}
          >
            {/* Card header */}
            <div style={{ padding: "1.75rem 2rem 1.25rem", borderBottom: "1px solid var(--rule)" }}>
              {step === 1 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step {currentPos + 1} of {totalSteps}</p>
                <h2 style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "0.04em", color: "var(--text-primary)", lineHeight: 1 }}>
                  Set Your Password
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Create a secure password to log in later.</p>
              </>}
              {step === 2 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step {currentPos + 1} of {totalSteps}</p>
                <h2 style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "0.04em", color: "var(--text-primary)", lineHeight: 1 }}>
                  Personal Information
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Tell us about yourself. Fields marked * are required.</p>
              </>}
              {step === 3 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step {currentPos + 1} of {totalSteps}</p>
                <h2 style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "0.04em", color: "var(--text-primary)", lineHeight: 1 }}>
                  Address
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Your current residential address in South Africa (or your on-base address). Fields marked * are required.</p>
              </>}
              {step === 4 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step {currentPos + 1} of {totalSteps}</p>
                <h2 style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "0.04em", color: "var(--text-primary)", lineHeight: 1 }}>
                  Passport &amp; Visa
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Your passport details are required for everyone. The visa section is only for international staff.</p>
              </>}
              {step === 5 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step {currentPos + 1} of {totalSteps}</p>
                <h2 style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "0.04em", color: "var(--text-primary)", lineHeight: 1 }}>
                  Emergency &amp; Health
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Emergency contact and health insurance details. Fields marked * are required.</p>
              </>}
              {step === 6 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step {currentPos + 1} of {totalSteps}</p>
                <h2 style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "0.04em", color: "var(--text-primary)", lineHeight: 1 }}>
                  Your Family
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Do you have a spouse or children? Add them here. This is optional — you can skip it and add them later from your profile.</p>
              </>}
              {step === 7 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step {currentPos + 1} of {totalSteps}</p>
                <h2 style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "0.04em", color: "var(--text-primary)", lineHeight: 1 }}>
                  Privacy &amp; Consent
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Please review and accept our data processing agreement.</p>
              </>}
            </div>

            {/* Card body */}
            <div style={{ padding: "1.5rem 2rem" }} className="space-y-4">

              {/* ── Step 1: Password ── */}
              {step === 1 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password">New Password *</Label>
                    <Input id="password" type="password" placeholder="At least 6 characters"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      required disabled={passwordSet} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm_password">Confirm Password *</Label>
                    <Input id="confirm_password" type="password" placeholder="Re-enter your password"
                      value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      required disabled={passwordSet} />
                  </div>
                  {passwordSet && (
                    <p style={{ fontSize: "12px", color: "var(--green-text)", fontWeight: 600 }}>
                      ✓ Password set successfully!
                    </p>
                  )}
                </>
              )}

              {/* ── Step 2: Personal Info ── */}
              {step === 2 && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="first_name">First Name *</Label>
                      <Input id="first_name" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last_name">Last Name *</Label>
                      <Input id="last_name" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="preferred_name">Preferred Name</Label>
                    <Input id="preferred_name" placeholder="What you like to be called" value={form.preferred_name} onChange={(e) => set("preferred_name", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="date_of_birth">Date of Birth *</Label>
                      <DateInput id="date_of_birth" value={form.date_of_birth} onChange={(v) => set("date_of_birth", v)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gender">Gender *</Label>
                      <select id="gender" value={form.gender} onChange={(e) => set("gender", e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="">Select…</option>
                        {genderOpts.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="marital_status">Marital Status *</Label>
                      <select id="marital_status" value={form.marital_status} onChange={(e) => set("marital_status", e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="">Select…</option>
                        <option value="single">Single</option>
                        <option value="married">Married</option>
                        <option value="divorced">Divorced</option>
                        <option value="widowed">Widowed</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nationality">Nationality *</Label>
                      <SearchableSelect id="nationality" value={form.nationality} onChange={(v) => set("nationality", v)} options={COUNTRY_OPTIONS} placeholder="Select…" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number *</Label>
                    <PhoneInput id="phone" value={form.phone} onChange={(v) => set("phone", v)} required />
                  </div>
                </>
              )}

              {/* ── Step 3: Address ── */}
              {step === 3 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="address_line_1">Address Line 1 *</Label>
                    <Input id="address_line_1" placeholder="Current street address in South Africa" value={form.address_line_1} onChange={(e) => set("address_line_1", e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address_line_2">Address Line 2</Label>
                    <Input id="address_line_2" placeholder="Apartment, unit, building (optional)" value={form.address_line_2} onChange={(e) => set("address_line_2", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="country">Country *</Label>
                      <SearchableSelect id="country" value={form.country} onChange={(v) => set("country", v)} options={COUNTRY_OPTIONS} placeholder="Select…" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city">City *</Label>
                      <Input id="city" placeholder="e.g. Potchefstroom" value={form.city} onChange={(e) => set("city", e.target.value)} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {!hideProvince && (
                    <div className="space-y-2">
                      <Label htmlFor="province">Province / State *</Label>
                      {form.country === "South Africa" ? (
                        <select id="province" value={form.province} onChange={(e) => set("province", e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                          <option value="">Select…</option>
                          {SA_PROVINCES.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <Input id="province" placeholder="State / Province" value={form.province} onChange={(e) => set("province", e.target.value)} required />
                      )}
                    </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="postal_code">Postal Code *</Label>
                      <Input id="postal_code" placeholder="e.g. 2520" value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} required />
                    </div>
                  </div>
                </>
              )}

              {/* ── Step 4: Passport & Visa ── */}
              {step === 4 && (
                <>
                  {/* Passport — required for everyone, South African or not */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="passport_country">Passport Country *</Label>
                      <SearchableSelect id="passport_country" value={form.passport_country} onChange={(v) => set("passport_country", v)} options={COUNTRY_OPTIONS} placeholder="Select…" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="passport_number">Passport Number *</Label>
                      <Input id="passport_number" placeholder="e.g. A12345678" value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="passport_expiry_date">Passport Expiry Date *</Label>
                    <DateInput id="passport_expiry_date" value={form.passport_expiry_date} onChange={(v) => set("passport_expiry_date", v)} />
                  </div>

                  {/* Are you South African? — "No" reveals the visa section below */}
                  <div className="space-y-2">
                    <Label htmlFor="is_south_african">Are you South African? *</Label>
                    <select
                      id="is_south_african"
                      value={form.is_international ? "no" : "yes"}
                      onChange={(e) => {
                        const isSA = e.target.value === "yes";
                        setForm((prev) => ({
                          ...prev,
                          is_international: !isSA,
                          ...(isSA && { visa_category: "", visa_type: "", visa_expiry_date: "" }),
                        }));
                      }}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                    <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>If no, please provide your visa details below.</p>
                  </div>

                  {form.is_international && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Visa Status *</Label>
                        <div className="grid grid-cols-1 gap-3">
                          {[
                            { value: "90_day", label: "90-Day Visa", sub: "Short-term visitor" },
                            { value: "long_term", label: "Long-Term Visa", sub: "Work, study, or religious" },
                          ].map((opt) => (
                            <label
                              key={opt.value}
                              className="flex items-center gap-3 cursor-pointer rounded-xl p-4"
                              style={{
                                border: `1px solid ${form.visa_category === opt.value ? "var(--yellow-border)" : "var(--surface-4)"}`,
                                background: form.visa_category === opt.value ? "var(--yellow-dim)" : "var(--surface-1)",
                              }}
                            >
                              <input type="radio" name="visa_category" value={opt.value}
                                checked={form.visa_category === opt.value}
                                onChange={() => setForm((prev) => ({ ...prev, visa_category: opt.value, visa_type: "", visa_expiry_date: "" }))}
                                className="h-4 w-4" />
                              <div>
                                <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{opt.label}</p>
                                <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{opt.sub}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      {form.visa_category === "long_term" && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="visa_type">Visa Type *</Label>
                            <Input id="visa_type" placeholder="e.g. Religious, Study" value={form.visa_type} onChange={(e) => set("visa_type", e.target.value)} required />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="visa_expiry_date">Visa Expiry Date *</Label>
                            <DateInput id="visa_expiry_date" value={form.visa_expiry_date} onChange={(v) => set("visa_expiry_date", v)} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ── Step 5: Emergency & Health ── */}
              {step === 5 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="emergency_contact_name">Emergency Contact Name *</Label>
                    <Input id="emergency_contact_name" placeholder="Full name" value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="emergency_contact_phone">Phone *</Label>
                      <PhoneInput id="emergency_contact_phone" value={form.emergency_contact_phone} onChange={(v) => set("emergency_contact_phone", v)} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="emergency_contact_relationship">Relationship *</Label>
                      <select id="emergency_contact_relationship" value={form.emergency_contact_relationship} onChange={(e) => set("emergency_contact_relationship", e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="">Select…</option>
                        {relationshipOpts.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ paddingTop: "0.75rem", borderTop: "1px solid var(--surface-4)" }}>
                    <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      Health Insurance
                    </p>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="health_insurance_provider">Provider *</Label>
                          {(() => {
                            // The DB stores the provider as a plain string. To
                            // distinguish "Other (specify)" from a recognised
                            // option, we check membership against the dropdown
                            // list — anything off-list is treated as Other.
                            const knownValues = new Set(insuranceOpts.map((o) => o.value));
                            const isOther = !!form.health_insurance_provider && !knownValues.has(form.health_insurance_provider);
                            const selectValue = isOther ? "other" : form.health_insurance_provider;
                            return (
                              <>
                                <select
                                  id="health_insurance_provider"
                                  value={selectValue}
                                  onChange={(e) => {
                                    // Selecting "other" clears the stored value
                                    // so the follow-up input renders empty;
                                    // selecting a known provider stores it
                                    // directly.
                                    set("health_insurance_provider", e.target.value === "other" ? "" : e.target.value);
                                  }}
                                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                  required
                                >
                                  <option value="">Select…</option>
                                  {insuranceOpts.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                                {(selectValue === "other" || isOther) && (
                                  <Input
                                    placeholder="Specify your provider"
                                    value={isOther ? form.health_insurance_provider : ""}
                                    onChange={(e) => set("health_insurance_provider", e.target.value)}
                                    required
                                  />
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="health_insurance_policy_number">Policy Number *</Label>
                          <Input id="health_insurance_policy_number" placeholder="e.g. 123456789" value={form.health_insurance_policy_number} onChange={(e) => set("health_insurance_policy_number", e.target.value)} required />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="health_insurance_expiry_date">Expiry Date *</Label>
                        <DateInput id="health_insurance_expiry_date" value={form.health_insurance_expiry_date} onChange={(v) => set("health_insurance_expiry_date", v)} />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ── Step 6: Family ── */}
              {step === 6 && (
                <>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                    Do you have a spouse or children? Add them here. For a spouse we
                    just need their name and email; for children we&rsquo;ll ask for
                    their passport, visa and health-insurance details. This is
                    optional and can be updated any time from your profile.
                  </p>
                  <HouseholdMembers
                    initialMembers={[]}
                    loadOnMount
                    refreshRouterOnChange={false}
                    selfDefaults={{
                      is_international: form.is_international,
                      visa_category: form.visa_category,
                      visa_type: form.visa_type,
                      visa_expiry_date: form.visa_expiry_date,
                      health_insurance_provider: form.health_insurance_provider,
                      health_insurance_policy_number: form.health_insurance_policy_number,
                      health_insurance_expiry_date: form.health_insurance_expiry_date,
                    }}
                  />
                </>
              )}

              {/* ── Step 7: Consent ── */}
              {step === 7 && (
                <>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                    Before you join FFSA Hub, please read and agree to the following
                    {requiredAgreements.length === 1 ? " policy" : " policies"}. Open
                    each to read the full text, then tick the box to confirm.
                  </p>
                  {requiredAgreements.map((a) => {
                    const on = consentChecked[a.kind] ?? false;
                    return (
                      <div
                        key={a.kind}
                        className="rounded-xl p-4 space-y-2"
                        style={{
                          border: `1px solid ${on ? "var(--yellow-border)" : "var(--surface-4)"}`,
                          background: on ? "var(--yellow-dim)" : "var(--surface-1)",
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                            {a.title}
                          </span>
                          <a
                            href={`/legal/consent?kind=${a.kind}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              flexShrink: 0,
                              fontSize: "11px",
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              textDecoration: "underline",
                            }}
                          >
                            Open to read →
                          </a>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              setConsentChecked((prev) => ({ ...prev, [a.kind]: e.target.checked }))
                            }
                            className="mt-1 h-4 w-4"
                          />
                          <span style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.5 }}>
                            I have read and agree to the {a.title}.
                          </span>
                        </label>
                        <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                          Version <span style={{ fontFamily: "monospace" }}>{a.version}</span>
                        </p>
                      </div>
                    );
                  })}
                </>
              )}

              {error && (
                <p style={{ fontSize: "12px", color: "hsl(0 70% 65%)", padding: "10px 12px", background: "hsl(0 70% 52% / 0.08)", borderRadius: "8px", border: "1px solid hsl(0 70% 52% / 0.2)" }}>
                  {error}
                </p>
              )}
            </div>

            {/* Card footer / nav */}
            <div
              className="flex justify-between items-center"
              style={{ padding: "1rem 2rem", borderTop: "1px solid var(--rule)" }}
            >
              <Button
                variant="outline"
                onClick={() => { setError(null); setStep(prevStep()); }}
                disabled={step === 1}
                style={{ visibility: step === 1 ? "hidden" : "visible" }}
              >
                ← Back
              </Button>

              {!isLastStep ? (
                <Button
                  disabled={saving}
                  onClick={async () => {
                    setError(null);
                    if (step === 1 && !passwordSet) {
                      const validationError = validatePassword(password); if (validationError) { setError(validationError); return; }
                      if (password !== confirmPassword) { setError("Passwords do not match."); return; }
                      setSaving(true);
                      const { error: pwError } = await supabase.auth.updateUser({ password });
                      setSaving(false);
                      if (pwError) { setError(pwError.message); return; }
                      setPasswordSet(true);
                      setStep(nextStep());
                      return;
                    }
                    const stepError = validateStep(step);
                    if (stepError) { setError(stepError); return; }
                    setStep(nextStep());
                  }}
                >
                  {step === 1 && !passwordSet ? (saving ? "Setting…" : "Set Password & Continue") : "Continue"}
                </Button>
              ) : (
                <Button onClick={handleFinish} disabled={saving}>
                  {saving ? "Saving…" : "Complete Setup"}
                </Button>
              )}
            </div>
          </div>

          {/* Slogan footer */}
          <p style={{ textAlign: "center", marginTop: "2rem", fontSize: "9px", letterSpacing: "0.25em", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
            Catalyse a Generation · Evangelise the World
          </p>
        </div>
      </div>
    </div>
  );
}
