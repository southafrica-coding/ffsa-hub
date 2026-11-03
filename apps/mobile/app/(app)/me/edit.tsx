import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Screen, TextField } from "@/components";
import { getProfileFields, updateProfile, type ProfileFields } from "@/features/me/api";
import { meStrings } from "@/features/me/strings";
import { hasErrors, validateProfile, type ProfileErrors } from "@/features/me/validation";
import { SkeletonRows, useMe } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

const s = meStrings.edit;

type Load = { state: "loading" } | { state: "error" } | { state: "ready" };

// Edit the basics (first name, last name, phone) through PUT
// /api/profile/update, the same route the web profile page uses. Everything
// else stays on the web ("Open full profile on the web").
export default function EditProfileScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { refresh } = useMe();
  const userId = session?.user?.id ?? null;

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [fields, setFields] = useState<ProfileFields>({ firstName: "", lastName: "", phone: "" });
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    getProfileFields(supabase, userId).then(
      (f) => {
        if (!active) return;
        setFields(f);
        setLoad({ state: "ready" });
      },
      () => active && setLoad({ state: "error" }),
    );
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  function set<K extends keyof ProfileFields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function save() {
    const found = validateProfile(fields);
    setErrors(found);
    setSaveError(null);
    if (hasErrors(found)) return;
    setSaving(true);
    try {
      await updateProfile(apiFetch, fields);
      refresh();
      router.back();
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      setSaveError(err instanceof ApiError && (err.kind === "network" || err.kind === "timeout") ? err.message : s.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen keyboard edges={["bottom"]}>
      {load.state === "loading" ? <SkeletonRows count={3} label={s.loading} /> : null}

      {load.state === "error" ? (
        <Banner
          tone="danger"
          title={meStrings.error.title}
          action={
            <Button
              label={meStrings.error.retry}
              variant="secondary"
              onPress={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            />
          }
        >
          {s.loadError}
        </Banner>
      ) : null}

      {load.state === "ready" ? (
        <View style={{ gap: 16 }}>
          {saveError ? (
            <Banner tone="danger" title={s.saveErrorTitle}>
              {saveError}
            </Banner>
          ) : null}
          <TextField
            label={s.firstName}
            value={fields.firstName}
            onChangeText={(v) => set("firstName", v)}
            error={errors.firstName}
            autoComplete="given-name"
            textContentType="givenName"
            autoCapitalize="words"
            returnKeyType="next"
          />
          <TextField
            label={s.lastName}
            value={fields.lastName}
            onChangeText={(v) => set("lastName", v)}
            error={errors.lastName}
            autoComplete="family-name"
            textContentType="familyName"
            autoCapitalize="words"
            returnKeyType="next"
          />
          <TextField
            label={s.phone}
            value={fields.phone}
            onChangeText={(v) => set("phone", v)}
            error={errors.phone}
            hint={s.phoneHint}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <Button label={s.save} onPress={save} loading={saving} />
        </View>
      ) : null}
    </Screen>
  );
}
