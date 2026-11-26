// Me › Health insurance. The web's insurance section + InsuranceHistory:
//   - current policy (read from the person's own users row under RLS; saved
//     through PUT /api/profile/update, the same route the web section uses)
//   - the yearly "still active?" check for an open-ended scheme
//     (POST /api/profile/insurance-confirm)
//   - the queued next policy (PUT/DELETE /api/profile/insurance-next)
//   - policies on record, with duplicates removable
//     (DELETE /api/profile/insurance-policies/[id])
// The server re-checks every rule (provider, dates, open-ended eligibility).

import { Pencil, Plus } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, NeedsYouBand, StaticRow, StatusChip, Text, TextField } from "@/components";
import { DateTimeField } from "@/features/bookings/components/DateTimeField";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { TextTone } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import {
  confirmDestructive,
  DocScreen,
  errorText,
  Intro,
  LoadGate,
  OptionField,
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
import { Group, GROUP_BLEED, Section } from "../components/me-kit";
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
    <View style={{ gap: 16 }} testID={testID}>
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
      {!open ? (
        <View style={{ gap: 6 }}>
          <DateTimeField mode="date" label={s.expiry} value={draft.expiry} onChange={(v) => set("expiry", v)} />
          {errors.expiry ? (
            <Text variant="caption" tone="danger" accessibilityRole="alert">
              {errors.expiry}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Banner tone="error" title={s.saveError}>
          {error}
        </Banner>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label={saveLabel} onPress={() => void submit()} loading={saving} style={{ flex: 1 }} />
        <Button label={d.cancel} variant="secondary" onPress={onCancel} disabled={saving} />
      </View>
    </View>
  );
}

/** The current policy's state in words, with a tone that only backs the words up. */
function statusLine(p: InsuranceRow): { text: string; tone: TextTone } {
  const st = insuranceStatus(p);
  switch (st.state) {
    case "no_expiry":
      return { text: s.status.no_expiry, tone: "default" };
    case "missing":
      return { text: s.status.missing, tone: "default" };
    case "expired":
      return { text: s.status.expired(formatDate(st.expiryDate)), tone: "danger" };
    case "expiring":
      return { text: s.status.expiring(formatDate(st.expiryDate), st.daysLeft ?? 0), tone: "attention" };
    default:
      return { text: s.status.ok(formatDate(st.expiryDate)), tone: "default" };
  }
}

const policyLine = (number: string | null | undefined) => (number ? s.policyLine(number) : `${s.policyNumber}: ${d.notSet}`);

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

  const current = data && hasCurrent ? statusLine(data.current) : null;

  return (
    <DocScreen title={s.title} refreshing={load.refreshing} onRefresh={load.refresh}>
      <Intro>{s.intro}</Intro>
      <LoadGate load={load} loadingLabel={s.loading} errorTitle={s.loadErrorTitle} />

      {data ? (
        <>
          {/* The one yellow band on this screen, only when the data calls for it. */}
          {band ? (
            <View style={{ marginHorizontal: GROUP_BLEED }}>
              <NeedsYouBand
                testID="insurance-needs-you"
                eyebrow={s.needsYou.title}
                text={band.text}
                actionLabel={band.confirm ? s.confirm : undefined}
                onAction={
                  band.confirm
                    ? () => {
                        if (busy === null) void act("confirm", () => confirmInsurance(profileFetch), s.confirmed, s.saveError);
                      }
                    : undefined
                }
              />
            </View>
          ) : null}

          {actionError ? (
            <Banner tone="error" title={s.saveError}>
              {actionError}
            </Banner>
          ) : null}

          <View>
            <Section title={s.current} tight />
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
              <View style={{ gap: 12 }}>
                {current ? (
                  <Group>
                    <StaticRow
                      testID="current-policy"
                      title={providerLabel(data.current.provider, options)}
                      subtitle={policyLine(data.current.policyNumber)}
                      note={current.text}
                      noteTone={current.tone}
                      extra={
                        data.current.noExpiry && data.current.confirmedAt ? s.lastConfirmed(formatDate(data.current.confirmedAt)) : undefined
                      }
                      accessibilityLabel={[
                        `${s.provider}: ${providerLabel(data.current.provider, options)}`,
                        `${s.policyNumber}: ${data.current.policyNumber || d.notSet}`,
                        `${s.expiry}: ${current.text}`,
                      ].join(". ")}
                    />
                  </Group>
                ) : (
                  <Text tone="secondary">{s.none}</Text>
                )}
                <Button
                  label={s.edit}
                  variant="secondary"
                  icon={<Pencil size={20} color={colors.text} />}
                  onPress={() => setEditing("current")}
                  disabled={editing !== null}
                />
              </View>
            )}
          </View>

          <View>
            <Section title={s.next} tight />
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
              <View style={{ gap: 12 }}>
                <Text tone="secondary">{s.nextIntro}</Text>
                {data.next ? (
                  <>
                    <Group>
                      <StaticRow
                        testID="next-policy"
                        title={providerLabel(data.next.provider, options)}
                        subtitle={[
                          policyLine(data.next.policyNumber),
                          data.next.noExpiry ? s.noExpiryShort : s.status.ok(formatDate(data.next.expiryDate)),
                        ].join(" · ")}
                        note={data.current.expiryDate ? s.nextTakesOver(formatDate(data.current.expiryDate)) : undefined}
                        accessibilityLabel={[
                          `${s.provider}: ${providerLabel(data.next.provider, options)}`,
                          `${s.policyNumber}: ${data.next.policyNumber || d.notSet}`,
                          `${s.expiry}: ${data.next.noExpiry ? s.noExpiryShort : formatDate(data.next.expiryDate)}`,
                          data.current.expiryDate ? s.nextTakesOver(formatDate(data.current.expiryDate)) : null,
                        ]
                          .filter(Boolean)
                          .join(". ")}
                      />
                    </Group>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      <Button
                        label={s.replaceNext}
                        variant="secondary"
                        size="small"
                        onPress={() => setEditing("next")}
                        disabled={editing !== null}
                        style={{ flexGrow: 1, flexBasis: "40%" }}
                      />
                      <Button
                        label={s.removeNext}
                        variant="danger"
                        size="small"
                        loading={busy === "remove-next"}
                        disabled={busy !== null || editing !== null}
                        onPress={() =>
                          void (async () => {
                            if (await confirmDestructive(s.removeNextConfirm, "", s.removeNext)) {
                              await act("remove-next", () => removeNextPolicy(profileFetch), d.file.removed, s.saveError);
                            }
                          })()
                        }
                        style={{ flexGrow: 1, flexBasis: "40%" }}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <Text>{s.nextNone}</Text>
                    <Button
                      label={s.addNext}
                      variant="secondary"
                      icon={<Plus size={20} color={colors.text} />}
                      onPress={() => setEditing("next")}
                      disabled={editing !== null}
                    />
                  </>
                )}
              </View>
            )}
          </View>

          <View>
            <Section title={s.history} tight />
            <Text tone="secondary">{data.history.length ? s.historyIntro : s.historyEmpty}</Text>
            {data.history.length ? (
              <Group style={{ marginTop: 12 }}>
                {data.history.map((p) => {
                  const isCurrent = p.id === curId;
                  const expiry = p.noExpiry ? s.noExpiryShort : formatDate(p.expiryDate);
                  const name = providerLabel(p.provider, options);
                  return (
                    <StaticRow
                      key={p.id}
                      testID={`policy-${p.id}`}
                      title={name}
                      subtitle={[p.policyNumber, expiry].filter(Boolean).join(" · ")}
                      accessibilityLabel={[name, p.policyNumber, expiry, isCurrent ? s.currentBadge : null].filter(Boolean).join(", ")}
                      trailing={
                        isCurrent ? (
                          // The words are in the row's own label; the chip is the visual of the same fact.
                          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <StatusChip label={s.currentBadge} variant="ink" icon={null} />
                          </View>
                        ) : deletable.has(p.id) ? (
                          <Button
                            label={s.deleteDuplicate}
                            variant="text"
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
                          />
                        ) : null
                      }
                    />
                  );
                })}
              </Group>
            ) : null}
          </View>
        </>
      ) : null}
    </DocScreen>
  );
}
