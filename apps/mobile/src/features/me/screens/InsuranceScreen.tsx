// Me › Health insurance. The web's insurance section + InsuranceHistory:
//   - current policy (read from the person's own users row under RLS; saved
//     through PUT /api/profile/update, the same route the web section uses)
//   - the yearly "still active?" check for an open-ended scheme
//     (POST /api/profile/insurance-confirm)
//   - the queued next policy (PUT/DELETE /api/profile/insurance-next)
//   - policies on record, with duplicates removable
//     (DELETE /api/profile/insurance-policies/[id])
// The server re-checks every rule (provider, dates, open-ended eligibility).

import { useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Text, TextField } from "@/components";
import { DateTimeField } from "@/features/bookings/components/DateTimeField";
import { SectionBar } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import {
  confirmDestructive,
  DocScreen,
  errorText,
  Intro,
  LoadGate,
  OptionField,
  ReadField,
  successTap,
  ToggleRow,
  useLoad,
} from "../components/docs-ui";
import {
  confirmInsurance,
  deletePolicyRecord,
  getInsurance,
  removeNextPolicy,
  saveCurrentPolicy,
  saveNextPolicy,
  type InsuranceData,
} from "../docs-api";
import {
  confirmationDue,
  currentPolicyBody,
  currentPolicyId,
  deletablePolicyIds,
  formatDate,
  hasValidNext,
  insuranceStatus,
  nextPolicyBody,
  providerAllowsNoExpiry,
  providerChoices,
  providerLabel,
  splitProvider,
  validatePolicy,
  type InsuranceRow,
  type Option,
  type PolicyDraft,
} from "../docs-logic";
import { profileFetch } from "../http";
import { meStrings } from "../strings";

const d = meStrings.docs;
const s = d.insurance;

function ignorable(err: unknown) {
  return err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated");
}

function draftOf(p: Pick<InsuranceRow, "provider" | "policyNumber" | "expiryDate" | "noExpiry"> | null, options: Option[]): PolicyDraft {
  const { choice, other } = splitProvider(p?.provider, options);
  return {
    choice,
    other,
    policyNumber: p?.policyNumber ?? "",
    expiry: (p?.expiryDate ?? "").slice(0, 10),
    noExpiry: !!p?.noExpiry,
  };
}

/** One policy form (current or next). */
function PolicyForm({
  initial,
  options,
  mustFollow,
  saveLabel,
  onSave,
  onCancel,
  testID,
}: {
  initial: PolicyDraft;
  options: Option[];
  mustFollow?: string | null;
  saveLabel: string;
  onSave: (draft: PolicyDraft) => Promise<void>;
  onCancel: () => void;
  testID: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validatePolicy>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = providerChoices(options);
  const canBeOpen = providerAllowsNoExpiry(draft.choice, options);
  const open = draft.noExpiry && canBeOpen;

  function set<K extends keyof PolicyDraft>(key: K, value: PolicyDraft[K]) {
    setDraft((p) => ({ ...p, [key]: value }));
    setErrors({});
  }

  async function submit() {
    const found = validatePolicy(draft, options, s.errors, { mustFollow });
    setErrors(found);
    setError(null);
    const first = found.provider ?? found.other ?? found.expiry;
    if (first) {
      announce(first);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } catch (err) {
      if (!ignorable(err)) setError(errorText(err, s.saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 14 }} testID={testID}>
      <OptionField label={s.provider} value={draft.choice} options={choices} onChange={(v) => set("choice", v)} error={errors.provider} />
      {draft.choice === "other" ? (
        <TextField label={s.providerOther} value={draft.other} onChangeText={(v) => set("other", v)} error={errors.other} autoCapitalize="words" />
      ) : null}
      <TextField
        label={s.policyNumber}
        value={draft.policyNumber}
        onChangeText={(v) => set("policyNumber", v)}
        hint={s.policyNumberHint}
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
      />
      {canBeOpen ? <ToggleRow label={s.noExpiry} hint={s.noExpiryHint} value={draft.noExpiry} onChange={(v) => set("noExpiry", v)} /> : null}
      {!open ? <DateTimeField mode="date" label={s.expiry} value={draft.expiry} onChange={(v) => set("expiry", v)} /> : null}
      {!open && errors.expiry ? (
        <Text tone="danger" accessibilityRole="alert">
          {errors.expiry}
        </Text>
      ) : null}
      {error ? (
        <Banner tone="danger" title={s.saveError}>
          {error}
        </Banner>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label={saveLabel} onPress={() => void submit()} loading={saving} style={{ flex: 1 }} />
        <Button label={d.cancel} variant="ghost" onPress={onCancel} disabled={saving} />
      </View>
    </View>
  );
}

function statusLine(p: InsuranceRow): string {
  const st = insuranceStatus(p);
  switch (st.state) {
    case "no_expiry":
      return s.status.no_expiry;
    case "missing":
      return s.status.missing;
    case "expired":
      return s.status.expired(formatDate(st.expiryDate));
    case "expiring":
      return s.status.expiring(formatDate(st.expiryDate), st.daysLeft ?? 0);
    default:
      return s.status.ok(formatDate(st.expiryDate));
  }
}

export function InsuranceScreen() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const { colors } = useTheme();
  const load = useLoad<InsuranceData>(() => (userId ? getInsurance(supabase, userId) : Promise.reject(new Error("signed out"))));
  const [editing, setEditing] = useState<"current" | "next" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const data = load.data;
  const options = data ? (data.providers.length ? data.providers : providerChoices([])) : [];

  async function reloadAfter(message: string) {
    setEditing(null);
    successTap();
    announce(message);
    load.refresh();
  }

  async function act(key: string, fn: () => Promise<unknown>, done: string, fallback: string) {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await reloadAfter(done);
    } catch (err) {
      if (!ignorable(err)) {
        const msg = errorText(err, fallback);
        setActionError(msg);
        announce(msg);
      }
    } finally {
      setBusy(null);
    }
  }

  let band: { text: string; confirm: boolean } | null = null;
  if (data) {
    const st = insuranceStatus(data.current);
    const covered = hasValidNext(data.next);
    if (confirmationDue(data.current)) band = { text: s.needsYou.confirm, confirm: true };
    else if (st.state === "expired" && !covered) band = { text: s.needsYou.expired, confirm: false };
    else if (st.state === "expiring" && !covered) band = { text: s.needsYou.expiring, confirm: false };
  }

  const curId = data ? currentPolicyId(data.history, data.current) : null;
  const deletable = data ? deletablePolicyIds(data.history, curId) : new Set<string>();
  const hasCurrent = !!data?.current.provider && data.current.provider.toLowerCase() !== "none";

  return (
    <DocScreen refreshing={load.refreshing} onRefresh={load.refresh}>
      <Intro>{s.intro}</Intro>
      <LoadGate load={load} loadingLabel={s.loading} errorTitle={s.loadErrorTitle} />

      {data ? (
        <>
          {/* The one yellow band on this screen, only when the data calls for it. */}
          {band ? (
            <Banner
              tone="needsYou"
              title={s.needsYou.title}
              testID="insurance-needs-you"
              action={
                band.confirm ? (
                  <Button
                    label={s.confirm}
                    variant="secondary"
                    loading={busy === "confirm"}
                    onPress={() => void act("confirm", () => confirmInsurance(profileFetch), s.confirmed, s.saveError)}
                  />
                ) : undefined
              }
            >
              {band.text}
            </Banner>
          ) : null}

          {actionError ? (
            <Banner tone="danger" title={s.saveError}>
              {actionError}
            </Banner>
          ) : null}

          <View style={{ gap: 14 }}>
            <SectionBar label={s.current} />
            {editing === "current" ? (
              <PolicyForm
                testID="current-form"
                initial={draftOf(data.current, options)}
                options={options}
                saveLabel={s.saveCurrent}
                onCancel={() => setEditing(null)}
                onSave={async (draft) => {
                  await saveCurrentPolicy(profileFetch, currentPolicyBody(draft, options));
                  await reloadAfter(d.saved);
                }}
              />
            ) : (
              <>
                {hasCurrent ? (
                  <>
                    <ReadField label={s.provider} value={providerLabel(data.current.provider, options)} />
                    <ReadField label={s.policyNumber} value={data.current.policyNumber || d.notSet} />
                    <ReadField label={s.expiry} value={statusLine(data.current)} />
                    {data.current.noExpiry && data.current.confirmedAt ? (
                      <Text variant="caption" tone="secondary">
                        {s.lastConfirmed(formatDate(data.current.confirmedAt))}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text tone="secondary">{s.none}</Text>
                )}
                <Button label={s.edit} variant="secondary" onPress={() => setEditing("current")} disabled={editing !== null} />
              </>
            )}
          </View>

          <View style={{ gap: 14 }}>
            <SectionBar label={s.next} />
            {data.current.noExpiry ? (
              <Text tone="secondary">{s.nextNotAllowed}</Text>
            ) : editing === "next" ? (
              <PolicyForm
                testID="next-form"
                initial={draftOf(data.next, options)}
                options={options}
                mustFollow={(data.current.expiryDate ?? "").slice(0, 10) || null}
                saveLabel={s.saveNext}
                onCancel={() => setEditing(null)}
                onSave={async (draft) => {
                  await saveNextPolicy(profileFetch, nextPolicyBody(draft, options));
                  await reloadAfter(d.saved);
                }}
              />
            ) : (
              <>
                <Text tone="secondary">{s.nextIntro}</Text>
                {data.next ? (
                  <>
                    <ReadField label={s.provider} value={providerLabel(data.next.provider, options)} />
                    <ReadField label={s.policyNumber} value={data.next.policyNumber || d.notSet} />
                    <ReadField
                      label={s.expiry}
                      value={data.next.noExpiry ? s.noExpiryShort : formatDate(data.next.expiryDate)}
                    />
                    {data.current.expiryDate ? (
                      <Text variant="caption" tone="secondary">
                        {s.nextTakesOver(formatDate(data.current.expiryDate))}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text>{s.nextNone}</Text>
                )}
                <Button
                  label={data.next ? s.replaceNext : s.addNext}
                  variant="secondary"
                  onPress={() => setEditing("next")}
                  disabled={editing !== null}
                />
                {data.next ? (
                  <Button
                    label={s.removeNext}
                    variant="ghost"
                    loading={busy === "remove-next"}
                    disabled={busy !== null || editing !== null}
                    onPress={() =>
                      void (async () => {
                        if (await confirmDestructive(s.removeNextConfirm, "", s.removeNext)) {
                          await act("remove-next", () => removeNextPolicy(profileFetch), d.file.removed, s.saveError);
                        }
                      })()
                    }
                  />
                ) : null}
              </>
            )}
          </View>

          <View>
            <SectionBar label={s.history} />
            <View style={{ paddingVertical: 12 }}>
              <Text tone="secondary">{data.history.length ? s.historyIntro : s.historyEmpty}</Text>
            </View>
            {data.history.map((p) => {
              const isCurrent = p.id === curId;
              const expiry = p.noExpiry ? s.noExpiryShort : formatDate(p.expiryDate);
              const name = providerLabel(p.provider, options);
              return (
                <View
                  key={p.id}
                  testID={`policy-${p.id}`}
                  style={{ paddingVertical: 12, gap: 6, borderBottomWidth: hairline, borderBottomColor: colors.rule }}
                >
                  <View
                    accessible
                    accessibilityLabel={[name, p.policyNumber, expiry, isCurrent ? s.currentBadge : null].filter(Boolean).join(", ")}
                  >
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Text variant="bodyStrong">{name}</Text>
                      {isCurrent ? (
                        <Text variant="label" style={{ borderWidth: hairline, borderColor: colors.text, paddingHorizontal: 6 }}>
                          {s.currentBadge}
                        </Text>
                      ) : null}
                    </View>
                    <Text tone="secondary">{[p.policyNumber, expiry].filter(Boolean).join(" · ")}</Text>
                  </View>
                  {deletable.has(p.id) ? (
                    <Button
                      label={s.deleteDuplicate}
                      variant="ghost"
                      accessibilityLabel={`${s.deleteDuplicate}: ${name} ${expiry}`}
                      loading={busy === p.id}
                      disabled={busy !== null}
                      onPress={() =>
                        void (async () => {
                          if (await confirmDestructive(s.deleteDuplicateConfirm, "", s.deleteDuplicate)) {
                            await act(p.id, () => deletePolicyRecord(profileFetch, p.id), d.file.removed, s.saveError);
                          }
                        })()
                      }
                      style={{ alignSelf: "flex-start" }}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </>
      ) : null}
    </DocScreen>
  );
}
