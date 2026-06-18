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
import {
  COUNTRY_OPTIONS,
  NATIONALITY_OPTIONS,
  SA_PROVINCES,
  GENDER_OPTIONS,
  RELATIONSHIP_OPTIONS,
  INSURANCE_PROVIDERS,
} from "@/lib/profile/options";
import Image from "next/image";

const TOTAL_STEPS = 6;

const STEP_LABELS = [
  "Password",
  "Personal",
  "Address",
  "Passport",
  "Emergency",
  "Consent",
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
  is_international: false, passport_country: "", passport_number: "",
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
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [agreementVersion, setAgreementVersion] = useState<string | null>(null);
  const [programName, setProgramName] = useState<string | null>(null);

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
        passport_country: appUser.passport_country ?? "", passport_number: appUser.passport_number ?? "",
        visa_category: appUser.visa_category ?? "", visa_type: appUser.visa_type ?? "",
        visa_expiry_date: appUser.visa_expiry_date ?? "",
        emergency_contact_name: appUser.emergency_contact_name ?? "",
        emergency_contact_phone: appUser.emergency_contact_phone ?? "",
        emergency_contact_relationship: appUser.emergency_contact_relationship ?? "",
        health_insurance_provider: appUser.health_insurance_provider ?? "",
        health_insurance_policy_number: appUser.health_insurance_policy_number ?? "",
        health_insurance_expiry_date: appUser.health_insurance_expiry_date ?? "",
      });

      // Fetch the current consent agreement version so we know what the user
      // is accepting at the moment they tick the box.
      try {
        const agreementRes = await fetch("/api/consent");
        if (agreementRes.ok) {
          const { agreement } = await agreementRes.json();
          setAgreementVersion(agreement?.version ?? null);
        }
      } catch {
        // Non-fatal; the consent step will display an error if no version is available.
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
      if (blank(form.province)) return "Province / state is required.";
      if (blank(form.country)) return "Country is required.";
      if (blank(form.postal_code)) return "Postal code is required.";
      return null;
    }
    if (s === 4) {
      // Local South Africans can skip this step entirely. Only international
      // staff need to fill in passport + visa details.
      if (!form.is_international) return null;
      if (blank(form.passport_country)) return "Passport country is required.";
      if (blank(form.passport_number)) return "Passport number is required.";
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
      if (blank(form.health_insurance_provider)) return "Health insurance provider is required.";
      if (blank(form.health_insurance_policy_number)) return "Health insurance policy number is required.";
      if (blank(form.health_insurance_expiry_date)) return "Health insurance expiry date is required.";
      if (isExpiryDatePast(form.health_insurance_expiry_date))
        return "Your health insurance has expired. Please enter the date your current policy expires.";
      return null;
    }
    return null;
  }

  async function handleFinish() {
    if (!userId) return;
    if (!consentAccepted) {
      setError("You must accept the Privacy & Data Processing Agreement to complete onboarding.");
      return;
    }
    if (!agreementVersion) {
      setError("Unable to load the privacy agreement. Please refresh and try again.");
      return;
    }
    setSaving(true); setError(null);
    try {
      const consentRes = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agreement_version: agreementVersion,
          source: "onboarding",
        }),
      });
      if (!consentRes.ok) {
        const result = await consentRes.json().catch(() => ({}));
        throw new Error(result.error ?? "Failed to record consent");
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
        passport_country: form.is_international ? nullify(form.passport_country) : null,
        passport_number: form.is_international ? nullify(form.passport_number) : null,
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
      <div className="flex min-h-screen items-center justify-center" style={{ background: "#0D0B09" }}>
        <p style={{ color: "var(--text-tertiary)", letterSpacing: "0.2em", fontSize: "11px", textTransform: "uppercase" }}>
          Loading…
        </p>
      </div>
    );
  }

  const progress = (step / TOTAL_STEPS) * 100;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#0D0B09" }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-8 py-5"
        style={{ borderBottom: "1px solid hsl(22 8% 12%)" }}
      >
        <div className="flex items-center gap-3">
          <Image src="/brand/ff-wordmark-white.png" alt="Fire & Fragrance" width={140} height={17} style={{ objectFit: "contain", display: "block" }} priority />
          <div style={{ height: "1px", width: "12px", background: "var(--yellow)" }} />
          <span style={{ fontSize: "8px", letterSpacing: "0.3em", fontWeight: 700, color: "var(--yellow)", textTransform: "uppercase" }}>
            Hub
          </span>
        </div>
        <p style={{ fontSize: "10px", letterSpacing: "0.2em", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
          Account Setup
        </p>
      </div>

      {/* Step indicator */}
      <div style={{ borderBottom: "1px solid hsl(22 8% 12%)" }}>
        <div className="flex">
          {STEP_LABELS.map((label, i) => {
            const stepNum = i + 1;
            const isDone = step > stepNum;
            const isActive = step === stepNum;
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
                    color: isActive ? "var(--yellow)" : isDone ? "hsl(42 95% 55% / 0.55)" : "var(--text-tertiary)",
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
                borderRadius: "12px",
                background: "var(--yellow-dim)",
                border: "1px solid var(--yellow-border)",
              }}
            >
              <p style={{ fontSize: "9px", letterSpacing: "0.2em", fontWeight: 700, textTransform: "uppercase", color: "var(--yellow)", marginBottom: "3px" }}>
                You&rsquo;ve been accepted
              </p>
              <p style={{ fontSize: "13px", color: "#F0EBE3", lineHeight: 1.4 }}>
                Finish setting up your profile to join{" "}
                <strong style={{ color: "#fff", fontWeight: 600 }}>{programName}</strong>.
              </p>
            </div>
          )}

          {/* Step card */}
          <div
            style={{
              background: "hsl(22 10% 8%)",
              border: "1px solid hsl(22 8% 14%)",
              borderRadius: "16px",
              overflow: "hidden",
            }}
          >
            {/* Card header */}
            <div style={{ padding: "1.75rem 2rem 1.25rem", borderBottom: "1px solid hsl(22 8% 12%)" }}>
              {step === 1 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step 1 of {TOTAL_STEPS}</p>
                <h2 style={{ fontFamily: "var(--font-bebas,'Arial Black',sans-serif)", fontSize: "2rem", letterSpacing: "0.04em", color: "#F0EBE3", lineHeight: 1 }}>
                  Set Your Password
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Create a secure password to log in later.</p>
              </>}
              {step === 2 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step 2 of {TOTAL_STEPS}</p>
                <h2 style={{ fontFamily: "var(--font-bebas,'Arial Black',sans-serif)", fontSize: "2rem", letterSpacing: "0.04em", color: "#F0EBE3", lineHeight: 1 }}>
                  Personal Information
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Tell us about yourself. Fields marked * are required.</p>
              </>}
              {step === 3 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step 3 of {TOTAL_STEPS}</p>
                <h2 style={{ fontFamily: "var(--font-bebas,'Arial Black',sans-serif)", fontSize: "2rem", letterSpacing: "0.04em", color: "#F0EBE3", lineHeight: 1 }}>
                  Address
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Your current address or on-base address. Fields marked * are required.</p>
              </>}
              {step === 4 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step 4 of {TOTAL_STEPS}</p>
                <h2 style={{ fontFamily: "var(--font-bebas,'Arial Black',sans-serif)", fontSize: "2rem", letterSpacing: "0.04em", color: "#F0EBE3", lineHeight: 1 }}>
                  Passport &amp; Visa
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Only for international staff. Local South Africans can skip.</p>
              </>}
              {step === 5 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step 5 of {TOTAL_STEPS}</p>
                <h2 style={{ fontFamily: "var(--font-bebas,'Arial Black',sans-serif)", fontSize: "2rem", letterSpacing: "0.04em", color: "#F0EBE3", lineHeight: 1 }}>
                  Emergency &amp; Health
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>Emergency contact and health insurance details. Fields marked * are required.</p>
              </>}
              {step === 6 && <>
                <p className="page-eyebrow" style={{ marginBottom: "6px" }}>Step 6 of {TOTAL_STEPS}</p>
                <h2 style={{ fontFamily: "var(--font-bebas,'Arial Black',sans-serif)", fontSize: "2rem", letterSpacing: "0.04em", color: "#F0EBE3", lineHeight: 1 }}>
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
                    <p style={{ fontSize: "12px", color: "hsl(142 55% 58%)", fontWeight: 600 }}>
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
                        {GENDER_OPTIONS.map((o) => (
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
                      <select id="nationality" value={form.nationality} onChange={(e) => set("nationality", e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="">Select…</option>
                        {NATIONALITY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
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
                    <Input id="address_line_1" placeholder="Street address" value={form.address_line_1} onChange={(e) => set("address_line_1", e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address_line_2">Address Line 2</Label>
                    <Input id="address_line_2" placeholder="Apartment, unit, building (optional)" value={form.address_line_2} onChange={(e) => set("address_line_2", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="country">Country *</Label>
                      <select id="country" value={form.country} onChange={(e) => set("country", e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="">Select…</option>
                        {COUNTRY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city">City *</Label>
                      <Input id="city" placeholder="e.g. Potchefstroom" value={form.city} onChange={(e) => set("city", e.target.value)} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
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
                  <label
                    className="flex items-center gap-3 cursor-pointer rounded-xl p-4"
                    style={{ border: "1px solid var(--surface-4)", background: "var(--surface-1)" }}
                  >
                    <input type="checkbox" checked={form.is_international}
                      onChange={(e) => setForm((prev) => ({
                        ...prev, is_international: e.target.checked,
                        ...(!e.target.checked && { passport_country: "", passport_number: "", visa_category: "", visa_type: "", visa_expiry_date: "" }),
                      }))}
                      className="h-4 w-4"
                    />
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>I am an international staff member or visitor</p>
                      <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Check this if you are not a South African citizen</p>
                    </div>
                  </label>

                  {form.is_international && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="passport_country">Passport Country *</Label>
                          <select id="passport_country" value={form.passport_country} onChange={(e) => set("passport_country", e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                            <option value="">Select…</option>
                            {COUNTRY_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="passport_number">Passport Number *</Label>
                          <Input id="passport_number" placeholder="e.g. A12345678" value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} required />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Visa Status *</Label>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { value: "90_day", label: "90-Day Visa", sub: "Short-term visitor" },
                            { value: "long_term", label: "Long-Term Visa", sub: "Work, study, or religious" },
                          ].map((opt) => (
                            <label
                              key={opt.value}
                              className="flex items-center gap-3 cursor-pointer rounded-xl p-3"
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
                                <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{opt.label}</p>
                                <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>{opt.sub}</p>
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
                        {RELATIONSHIP_OPTIONS.map((o) => (
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
                            const knownValues = new Set(INSURANCE_PROVIDERS.map((o) => o.value));
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
                                  {INSURANCE_PROVIDERS.map((o) => (
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

              {/* ── Step 6: Consent ── */}
              {step === 6 && (
                <>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                    Before you join FFSA Hub, we need your consent to collect and use your
                    personal information for program administration, communications, and
                    legal compliance.
                  </p>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                    Please open and read the agreement, then tick the box below to confirm.
                  </p>
                  <a
                    href="/legal/consent"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      fontSize: "12px",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      color: "var(--yellow)",
                      textDecoration: "underline",
                    }}
                  >
                    Open Privacy &amp; Data Processing Agreement →
                  </a>
                  <label
                    className="flex items-start gap-3 cursor-pointer rounded-xl p-4"
                    style={{
                      border: `1px solid ${consentAccepted ? "var(--yellow-border)" : "var(--surface-4)"}`,
                      background: consentAccepted ? "var(--yellow-dim)" : "var(--surface-1)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={consentAccepted}
                      onChange={(e) => setConsentAccepted(e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.5 }}>
                      I have read and agree to the FFSA Privacy &amp; Data Processing
                      Agreement. I consent to FFSA collecting, storing, and using my
                      personal information for the purposes described in the agreement,
                      and to receiving communications from FFSA related to my account
                      and programs.
                    </span>
                  </label>
                  {agreementVersion && (
                    <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      Agreement version: <span style={{ fontFamily: "monospace" }}>{agreementVersion}</span>
                    </p>
                  )}
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
              style={{ padding: "1rem 2rem", borderTop: "1px solid hsl(22 8% 12%)" }}
            >
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 1}>
                Back
              </Button>

              {step < TOTAL_STEPS ? (
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
                      setStep((s) => s + 1);
                      return;
                    }
                    const stepError = validateStep(step);
                    if (stepError) { setError(stepError); return; }
                    setStep((s) => s + 1);
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
