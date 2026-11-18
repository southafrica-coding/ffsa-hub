// Me › About your role (staff only — the web profile's Work tab). The essence
// statement is editable (PATCH /api/profile/cv, self); the job description
// and the CV entries are read-only here: the job description is set by the
// ministry leader, and adding / editing entries stays on the website for now.
// Reads come from the person's own rows under RLS.

import { useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Text, TextField } from "@/components";
import { ListRow, SectionBar, StateMessage, openWebPage, useMe } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { DocScreen, errorText, Intro, LoadGate, ReadField, successTap, useLoad } from "../components/docs-ui";
import { getCv, saveEssence, type CvEntry } from "../docs-api";
import { formatDate, isStaff } from "../docs-logic";
import { profileFetch } from "../http";
import { STAFF_CV_PATH } from "../links";
import { meStrings } from "../strings";

const d = meStrings.docs;
const s = d.cv;
const ORDER = ["skill", "workshop", "involvement", "training", "other"];

function groupEntries(entries: CvEntry[]) {
  const by = new Map<string, CvEntry[]>();
  for (const e of entries) by.set(e.category, [...(by.get(e.category) ?? []), e]);
  const cats = [...ORDER.filter((c) => by.has(c)), ...[...by.keys()].filter((c) => !ORDER.includes(c))];
  return cats.map((c) => ({ category: c, entries: by.get(c) ?? [] }));
}

function CvBody({ userId }: { userId: string }) {
  const { colors } = useTheme();
  const load = useLoad(() => getCv(supabase, userId));
  const [essence, setEssence] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = load.data;
  const value = essence ?? data?.essence ?? "";
  const changed = !!data && value.trim() !== data.essence.trim();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveEssence(profileFetch, value);
      load.setData((prev) => ({ ...prev, essence: value.trim() }));
      setEssence(null);
      successTap();
      announce(d.saved);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      setError(errorText(err, s.saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DocScreen
      refreshing={load.refreshing}
      onRefresh={() => {
        setEssence(null);
        load.refresh();
      }}
    >
      <Intro>{s.intro}</Intro>
      <LoadGate load={load} loadingLabel={s.loading} errorTitle={s.loadErrorTitle} />

      {data ? (
        <>
          <View style={{ gap: 12 }}>
            <SectionBar label={s.essence} />
            <TextField
              label={s.essence}
              value={value}
              onChangeText={setEssence}
              hint={s.essenceHint}
              multiline
              textAlignVertical="top"
              style={{ minHeight: 120 }}
            />
            {error ? (
              <Banner tone="danger" title={s.saveError}>
                {error}
              </Banner>
            ) : null}
            <Button label={d.save} onPress={() => void save()} loading={saving} disabled={!changed} />
          </View>

          <View style={{ gap: 8 }}>
            <SectionBar label={s.jobDescription} />
            {data.jobDescription ? (
              <>
                <ReadField label={s.jobDescription} value={data.jobDescription} />
                <Text variant="caption" tone="secondary">
                  {s.jobDescriptionNote}
                </Text>
              </>
            ) : (
              <Text tone="secondary">{s.jobDescriptionNone}</Text>
            )}
          </View>

          <View>
            <SectionBar label={s.entries} />
            {data.entries.length === 0 ? (
              <View style={{ paddingVertical: 12 }}>
                <Text tone="secondary">{s.entriesEmpty}</Text>
              </View>
            ) : (
              groupEntries(data.entries).map((g) => (
                <View key={g.category} style={{ paddingTop: 12 }}>
                  <Text variant="monoLabel" tone="secondary" accessibilityRole="header">
                    {s.categories[g.category] ?? g.category}
                  </Text>
                  {g.entries.map((e) => {
                    const dates = [e.start_date, e.end_date].filter(Boolean).map((v) => formatDate(v)).join(" – ");
                    const byLeadership = e.added_by_role && e.added_by_role !== "self";
                    return (
                      <View
                        key={e.id}
                        accessible
                        accessibilityLabel={[e.title, e.description, dates, byLeadership ? s.addedByLeadership : null].filter(Boolean).join(". ")}
                        style={{ paddingVertical: 10, gap: 2, borderBottomWidth: hairline, borderBottomColor: colors.rule }}
                      >
                        <Text variant="bodyStrong">{e.title}</Text>
                        {e.description ? <Text tone="secondary">{e.description}</Text> : null}
                        {dates || byLeadership ? (
                          <Text variant="caption" tone="secondary">
                            {[dates, byLeadership ? s.addedByLeadership : null].filter(Boolean).join(" · ")}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))
            )}
            <ListRow title={s.entriesWeb} trailing="web" onPress={() => void openWebPage(STAFF_CV_PATH, colors)} />
          </View>
        </>
      ) : null}
    </DocScreen>
  );
}

export function CvScreen() {
  const { session } = useSession();
  const { status, me } = useMe();
  const userId = session?.user?.id ?? null;

  // UX gate only: the web shows this to staff; RLS and the API decide for real.
  if (status === "ready" && !isStaff(me)) {
    return (
      <DocScreen refreshing={false} onRefresh={() => {}}>
        <StateMessage testID="not-staff" title={s.notStaff.title} body={s.notStaff.body} />
      </DocScreen>
    );
  }
  if (!userId) return null;
  return <CvBody userId={userId} />;
}
