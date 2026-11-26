// Me › Household › add / edit one family member. Mirrors the web form:
// a spouse is captured lightly (first name, last name, email); a child has
// name, birth date, gender, passport, visa (only if international; type and
// expiry only for a long-term visa) and health insurance, with "same as mine"
// copying the person's own visa + insurance. POST /api/profile/household or
// PUT/DELETE /api/profile/household/[id]; the server re-validates everything.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, EmptyState, Text, TextField } from "@/components";
import { DateTimeField } from "@/features/bookings/components/DateTimeField";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

import { confirmDestructive, DocScreen, errorText, LoadGate, OptionField, successTap, ToggleRow, useLoad } from "../components/docs-ui";
import { COUNTRIES } from "../data/countries";
import { getHousehold, removeMember, saveMember, type HouseholdSelf, type Member } from "../docs-api";
import {
  memberBody,
  providerAllowsNoExpiry,
  providerChoices,
  splitProvider,
  validateMember,
  type MemberDraft,
  type Option,
} from "../docs-logic";
import { profileFetch } from "../http";
import { meStrings } from "../strings";

const d = meStrings.docs;
const s = d.member;
const rels = d.household.relationship;

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
const VISA_CATEGORIES = [
  { value: "90_day", label: "90-Day Visa" },
  { value: "long_term", label: "Long-Term Visa" },
];
const PASSPORT_COUNTRIES = COUNTRIES.map(([, name]) => ({ value: name, label: name }));

function draftFrom(m: Member | null, relationship: string, options: Option[]): MemberDraft {
  const ins = splitProvider(m?.health_insurance_provider, options);
  return {
    relationship: m?.relationship ?? relationship,
    firstName: m?.first_name ?? "",
    lastName: m?.last_name ?? "",
    email: m?.email ?? "",
    fullName: m?.full_name ?? "",
    dateOfBirth: (m?.date_of_birth ?? "").slice(0, 10),
    gender: m?.gender ?? "",
    passportCountry: m?.passport_country ?? "",
    passportNumber: m?.passport_number ?? "",
    passportExpiry: (m?.passport_expiry_date ?? "").slice(0, 10),
    isInternational: !!m?.is_international,
    visaCategory: m?.visa_category ?? "",
    visaType: m?.visa_type ?? "",
    visaExpiry: (m?.visa_expiry_date ?? "").slice(0, 10),
    insuranceChoice: ins.choice,
    insuranceOther: ins.other,
    policyNumber: m?.health_insurance_policy_number ?? "",
    insuranceExpiry: (m?.health_insurance_expiry_date ?? "").slice(0, 10),
    noExpiry: !!m?.health_insurance_no_expiry,
  };
}

/** The person's own visa + insurance, for "same as mine". */
function copyFromSelf(draft: MemberDraft, self: HouseholdSelf, options: Option[], on: boolean): MemberDraft {
  if (!on) {
    return { ...draft, isInternational: false, visaCategory: "", visaType: "", visaExpiry: "", insuranceChoice: "", insuranceOther: "", policyNumber: "", insuranceExpiry: "", noExpiry: false };
  }
  const ins = splitProvider(self.health_insurance_provider, options);
  return {
    ...draft,
    isInternational: self.is_international,
    visaCategory: self.visa_category ?? "",
    visaType: self.visa_type ?? "",
    visaExpiry: (self.visa_expiry_date ?? "").slice(0, 10),
    insuranceChoice: ins.choice,
    insuranceOther: ins.other,
    policyNumber: self.health_insurance_policy_number ?? "",
    insuranceExpiry: (self.health_insurance_expiry_date ?? "").slice(0, 10),
    noExpiry: self.health_insurance_no_expiry,
  };
}

/** A group heading inside the form (sentence case, not a bar). */
function FormHeading({ children }: { children: string }) {
  return (
    <Text variant="sectionTitle" accessibilityRole="header" style={{ paddingTop: 8 }}>
      {children}
    </Text>
  );
}

export function HouseholdMemberScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; relationship?: string }>();
  const id = typeof params.id === "string" && params.id ? params.id : null;
  const askedRel = params.relationship === "spouse" ? "spouse" : "child";
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const load = useLoad((signal) =>
    userId ? getHousehold(profileFetch, supabase, userId, signal) : Promise.reject(new Error("signed out")),
  );

  const data = load.data;
  const options = data ? (data.providers.length ? data.providers : providerChoices([])) : [];
  const member = data && id ? (data.members.find((m) => m.id === id) ?? null) : null;
  const missing = !!data && !!id && !member;

  const [draft, setDraft] = useState<MemberDraft | null>(null);
  const [sameAsMe, setSameAsMe] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof validateMember>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = draft ?? (data && !missing ? draftFrom(member, askedRel, options) : null);
  const relLabel = rels[form?.relationship ?? askedRel] ?? askedRel;
  const title = id ? s.titleEdit(relLabel) : s.titleAdd(relLabel);

  function set<K extends keyof MemberDraft>(key: K, value: MemberDraft[K]) {
    if (!form) return;
    setDraft({ ...form, [key]: value });
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function save() {
    if (!form) return;
    const found = validateMember(form, s.errors);
    setErrors(found);
    setError(null);
    const firstErr = found.firstName ?? found.lastName ?? found.email ?? found.fullName;
    if (firstErr) {
      announce(firstErr);
      return;
    }
    setSaving(true);
    try {
      await saveMember(profileFetch, id, memberBody(form, options));
      successTap();
      announce(d.saved);
      router.back();
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      const msg = errorText(err, s.saveError);
      setError(msg);
      announce(msg);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id) return;
    if (!(await confirmDestructive(s.removeConfirmTitle, s.removeConfirmBody, s.remove))) return;
    setRemoving(true);
    setError(null);
    try {
      await removeMember(profileFetch, id);
      announce(d.file.removed);
      router.back();
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      setError(errorText(err, s.removeError));
    } finally {
      setRemoving(false);
    }
  }

  const isSpouse = form?.relationship === "spouse";
  const canBeOpen = form ? providerAllowsNoExpiry(form.insuranceChoice, options) : false;
  const openEnded = !!form?.noExpiry && canBeOpen;

  return (
    <DocScreen
      title={title}
      backLabel={d.household.title}
      tabBarHidden
      refreshing={load.refreshing}
      onRefresh={() => {
        setDraft(null);
        load.refresh();
      }}
    >
      <LoadGate load={load} loadingLabel={d.household.loading} errorTitle={d.household.loadErrorTitle} />
      {missing ? <EmptyState testID="member-missing" title={s.notFound} actionLabel={d.cancel} onAction={() => router.back()} /> : null}

      {form ? (
        <View style={{ gap: 16 }}>
          {error ? (
            <Banner tone="error" title={s.saveError}>
              {error}
            </Banner>
          ) : null}

          {isSpouse ? (
            <>
              <TextField label={s.firstName} value={form.firstName} onChangeText={(v) => set("firstName", v)} error={errors.firstName} autoCapitalize="words" />
              <TextField label={s.lastName} value={form.lastName} onChangeText={(v) => set("lastName", v)} error={errors.lastName} autoCapitalize="words" />
              <TextField
                label={s.email}
                value={form.email}
                onChangeText={(v) => set("email", v)}
                error={errors.email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text variant="caption" tone="secondary">
                {s.spouseNote}
              </Text>
            </>
          ) : (
            <>
              <TextField label={s.fullName} value={form.fullName} onChangeText={(v) => set("fullName", v)} error={errors.fullName} autoCapitalize="words" />
              <DateTimeField mode="date" label={s.dateOfBirth} value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} clearable />
              <OptionField label={s.gender} value={form.gender} options={GENDERS} onChange={(v) => set("gender", v)} />

              {!id && data ? (
                <ToggleRow
                  label={s.sameAsMe}
                  hint={s.sameAsMeHint}
                  value={sameAsMe}
                  onChange={(on) => {
                    setSameAsMe(on);
                    setDraft(copyFromSelf(form, data.self, options, on));
                  }}
                />
              ) : null}

              <FormHeading>{s.passport}</FormHeading>
              <OptionField label={s.passportCountry} value={form.passportCountry} options={PASSPORT_COUNTRIES} onChange={(v) => set("passportCountry", v)} searchable />
              <TextField
                label={s.passportNumber}
                value={form.passportNumber}
                onChangeText={(v) => set("passportNumber", v)}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
              />
              <DateTimeField mode="date" label={s.passportExpiry} value={form.passportExpiry} onChange={(v) => set("passportExpiry", v)} clearable />

              <ToggleRow label={s.international} hint={s.internationalHint} value={form.isInternational} onChange={(v) => set("isInternational", v)} />
              {form.isInternational ? (
                <>
                  <FormHeading>{s.visa}</FormHeading>
                  <OptionField label={s.visaCategory} value={form.visaCategory} options={VISA_CATEGORIES} onChange={(v) => set("visaCategory", v)} />
                  {form.visaCategory === "long_term" ? (
                    <>
                      <TextField label={s.visaType} value={form.visaType} onChangeText={(v) => set("visaType", v)} hint={s.visaTypeHint} />
                      <DateTimeField mode="date" label={s.visaExpiry} value={form.visaExpiry} onChange={(v) => set("visaExpiry", v)} clearable />
                    </>
                  ) : null}
                </>
              ) : null}

              <FormHeading>{s.insurance}</FormHeading>
              <OptionField
                label={d.insurance.provider}
                value={form.insuranceChoice}
                options={providerChoices(options)}
                onChange={(v) => set("insuranceChoice", v)}
              />
              {form.insuranceChoice === "other" ? (
                <TextField label={d.insurance.providerOther} value={form.insuranceOther} onChangeText={(v) => set("insuranceOther", v)} autoCapitalize="words" />
              ) : null}
              <TextField
                label={d.insurance.policyNumber}
                value={form.policyNumber}
                onChangeText={(v) => set("policyNumber", v)}
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
              />
              {canBeOpen ? <ToggleRow label={d.insurance.noExpiry} value={form.noExpiry} onChange={(v) => set("noExpiry", v)} /> : null}
              {!openEnded ? (
                <DateTimeField mode="date" label={d.insurance.expiry} value={form.insuranceExpiry} onChange={(v) => set("insuranceExpiry", v)} clearable />
              ) : null}
            </>
          )}

          <Button label={id ? d.save : s.add} onPress={() => void save()} loading={saving} disabled={removing} />
          {id ? <Button label={s.remove} variant="danger" onPress={() => void remove()} loading={removing} disabled={saving} /> : null}
        </View>
      ) : null}
    </DocScreen>
  );
}
