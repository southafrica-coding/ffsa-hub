// Me › Driver's licence. Same fields and rules as the web's LicenceCard:
// number, expiry, issuing country (ISO code), code, the licence photo, and the
// base-vehicle driving test result (read-only). GET/PUT/POST/DELETE
// /api/profile/licence; the photo is only reached through a signed URL.

import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, Text, TextField } from "@/components";
import { DateTimeField } from "@/features/bookings/components/DateTimeField";
import { SectionBar } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";

import { DocFile } from "../components/DocFile";
import { DocScreen, errorText, Intro, LoadGate, OptionField, ReadField, successTap, useLoad } from "../components/docs-ui";
import { COUNTRIES } from "../data/countries";
import { getLicence, saveLicence, type Licence } from "../docs-api";
import { formatDate, isPast, validateLicence, type LicenceDraft } from "../docs-logic";
import { profileFetch } from "../http";
import { meStrings } from "../strings";

const d = meStrings.docs;
const s = d.licence;
const COUNTRY_CHOICES = COUNTRIES.map(([iso, name]) => ({ value: iso, label: name }));

function draftFrom(l: Licence): LicenceDraft {
  return {
    number: l.drivers_licence_number ?? "",
    country: l.licence_country ?? "ZA",
    code: l.licence_code ?? "",
    expiry: (l.licence_expiry_date ?? "").slice(0, 10),
  };
}

export function LicenceScreen() {
  const load = useLoad((signal) => getLicence(profileFetch, signal));
  const [draft, setDraft] = useState<LicenceDraft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<"number" | "expiry", string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const licence = load.data;
  // The form starts from what's on file, and restarts after a refresh.
  const form = draft ?? (licence ? draftFrom(licence) : null);

  function set<K extends keyof LicenceDraft>(key: K, value: string) {
    if (!form) return;
    setDraft({ ...form, [key]: value });
    setSaved(false);
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function save() {
    if (!form) return;
    const found = validateLicence(form, s.errors);
    setErrors(found);
    setSaveError(null);
    if (found.number || found.expiry) {
      announce(found.number ?? found.expiry);
      return;
    }
    setSaving(true);
    try {
      await saveLicence(profileFetch, form);
      load.setData((l) => ({
        ...l,
        drivers_licence_number: form.number.trim(),
        licence_country: form.country,
        licence_code: form.code.trim(),
        licence_expiry_date: form.expiry,
      }));
      setDraft(null);
      setSaved(true);
      successTap();
      announce(d.saved);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      setSaveError(errorText(err, s.saveError));
    } finally {
      setSaving(false);
    }
  }

  const expired = licence ? isPast(licence.licence_expiry_date) : false;
  const testStatus = licence ? (s.testStatus[licence.base_driving_test_status] ?? s.testStatus.not_required) : "";

  return (
    <DocScreen
      refreshing={load.refreshing}
      onRefresh={() => {
        setDraft(null);
        load.refresh();
      }}
    >
      <Intro>{s.intro}</Intro>
      <LoadGate load={load} loadingLabel={s.loading} errorTitle={s.loadErrorTitle} />

      {licence && form ? (
        <>
          {/* A problem to fix, not a task: red, never the yellow band. */}
          {expired ? (
            <Banner tone="danger" title={s.expiredTitle}>
              {s.expired(formatDate(licence.licence_expiry_date))}
            </Banner>
          ) : null}

          <View style={{ gap: 16 }}>
            <SectionBar label={s.title} />
            <TextField
              label={s.number}
              value={form.number}
              onChangeText={(v) => set("number", v)}
              error={errors.number}
              hint={s.numberHint}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
            />
            <DateTimeField mode="date" label={s.expiry} value={form.expiry} onChange={(v) => set("expiry", v)} testID="licence-expiry" />
            {errors.expiry ? (
              <Text tone="danger" accessibilityRole="alert">
                {errors.expiry}
              </Text>
            ) : null}
            <OptionField label={s.country} value={form.country} options={COUNTRY_CHOICES} onChange={(v) => set("country", v)} searchable />
            <TextField
              label={s.code}
              value={form.code}
              onChangeText={(v) => set("code", v)}
              hint={s.codeHint}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {saveError ? (
              <Banner tone="danger" title={s.saveError}>
                {saveError}
              </Banner>
            ) : null}
            <Button label={saved ? d.saved : s.saveDetails} onPress={() => void save()} loading={saving} />
          </View>

          <View style={{ gap: 12 }}>
            <SectionBar label={s.fileLabel} />
            <DocFile
              kind="licence"
              label={s.fileLabel}
              uploadName="licence.jpg"
              file={{ hasFile: licence.has_file, fileName: licence.licence_file_name, signedUrl: licence.signed_url }}
              onChange={(next) =>
                load.setData((l) => ({ ...l, has_file: next.hasFile, licence_file_name: next.fileName, signed_url: next.signedUrl }))
              }
            />
            <Intro>{d.privacyVehicles}</Intro>
          </View>

          <ReadField
            label={s.test}
            value={
              licence.base_driving_test_passed_at
                ? `${testStatus}. ${s.testPassedOn(formatDate(licence.base_driving_test_passed_at))}`
                : testStatus
            }
          />
        </>
      ) : null}
    </DocScreen>
  );
}
