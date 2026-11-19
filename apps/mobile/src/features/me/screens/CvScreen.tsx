// Me › About your role (staff only — the web profile's Work tab). The essence
// statement is editable (PATCH /api/profile/cv, self); the job description
// and the CV entries are read-only here: the job description is set by the
// ministry leader, and adding / editing entries stays on the website for now.
// Reads come from the person's own rows under RLS.

import { useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, EmptyState, ListRow, Text, TextField } from "@/components";
import { openWebPage, useMe } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/theme/use-theme";

import { DocScreen, errorText, Intro, LoadGate, ReadField, successTap, useLoad } from "../components/docs-ui";
import { BlockLabel, Group, Section, StaticRow } from "../components/me-kit";
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
      title={s.title}
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
          <View style={{ gap: 16 }}>
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
              <Banner tone="error" title={s.saveError}>
                {error}
              </Banner>
            ) : null}
            <Button label={d.save} onPress={() => void save()} loading={saving} disabled={!changed} />
          </View>

          {data.jobDescription ? (
            <ReadField label={s.jobDescription} value={data.jobDescription} note={s.jobDescriptionNote} />
          ) : (
            <View style={{ gap: 2 }}>
              <Text variant="label">{s.jobDescription}</Text>
              <Text tone="secondary">{s.jobDescriptionNone}</Text>
            </View>
          )}

          <View>
            <Section title={s.entries} tight />
            {data.entries.length === 0 ? <Text tone="secondary">{s.entriesEmpty}</Text> : null}
            {groupEntries(data.entries).map((g) => (
              <View key={g.category}>
                <BlockLabel>{s.categories[g.category] ?? g.category}</BlockLabel>
                <Group>
                  {g.entries.map((e) => {
                    const dates = [e.start_date, e.end_date].filter(Boolean).map((v) => formatDate(v)).join(" – ");
                    const byLeadership = e.added_by_role && e.added_by_role !== "self";
                    const meta = [dates, byLeadership ? s.addedByLeadership : null].filter(Boolean).join(" · ");
                    return (
                      <StaticRow
                        key={e.id}
                        title={e.title}
                        subtitle={e.description || undefined}
                        extra={meta || undefined}
                        accessibilityLabel={[e.title, e.description, dates, byLeadership ? s.addedByLeadership : null].filter(Boolean).join(". ")}
                      />
                    );
                  })}
                </Group>
              </View>
            ))}
            <Group style={{ marginTop: 12 }}>
              <ListRow title={s.entriesWeb} trailing="web" onPress={() => void openWebPage(STAFF_CV_PATH, colors)} />
            </Group>
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
      <DocScreen title={s.title} refreshing={false} onRefresh={() => {}}>
        <EmptyState testID="not-staff" title={s.notStaff.title} body={s.notStaff.body} />
      </DocScreen>
    );
  }
  if (!userId) return null;
  return <CvBody userId={userId} />;
}
