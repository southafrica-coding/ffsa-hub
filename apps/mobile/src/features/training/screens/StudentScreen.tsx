import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Masthead, Screen, Text } from "@/components";
import { ErrorState, Skeleton, Tag } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { Segments } from "@/features/prayer/components/ui";
import { apiFetch } from "@/lib/api-client";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { getStudent, loadErrorMessage, takeCare, type Checkin, type JourneyItem, type StudentRecord } from "../api";
import { shortDate } from "../logic";
import { strings } from "../strings";

const r = strings.record;
type Tab = "journey" | "checkins";

// One student (48c + 48d): masthead, who walks with them, a Check in
// button, then Journey or Check-ins. An open "needs care" flag is this
// screen's one yellow band, with "I'll take it".
export default function StudentScreen({ id }: { id: string }) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const load = useCallback(() => getStudent(apiFetch, id), [id]);
  const { state, refresh, retry } = useCachedLoad<StudentRecord>({
    userId,
    cacheName: `training.student.${id}`,
    load,
    errorMessage: loadErrorMessage,
  });
  const [tab, setTab] = useState<Tab>("journey");

  // Back from the check-in form: show what was just saved.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  if (state.status === "loading") {
    return (
      <Screen edges={[]}>
        <Skeleton label={r.loading} />
      </Screen>
    );
  }
  if (state.status === "error") {
    return (
      <Screen edges={[]}>
        <ErrorState title={r.errorTitle} message={state.message} onRetry={retry} />
      </Screen>
    );
  }

  const { student, checkins, journey, today } = state.data;
  const openCare = checkins.find((c) => c.needsCare && !c.careTaken) ?? null;
  const mineThisWeek = checkins.some((c) => c.mine && today && c.weekOf === mondayOf(today));

  return (
    <Screen edges={[]}>
      <Masthead
        context={`${student.programName ? `${student.programName.toUpperCase()} · ` : ""}${strings.status[student.status].toUpperCase()}`}
        title={student.name}
      />
      {openCare ? <CareBand checkin={openCare} onTaken={refresh} /> : null}
      <Text tone="secondary">{strings.list.walkingWith(student.walkers.map((w) => w.name))}</Text>
      <Button
        label={mineThisWeek ? r.checkInAgain : r.checkIn}
        onPress={() => router.push({ pathname: "/training/checkin/[id]", params: { id, name: student.name } })}
        testID="training-checkin-open"
      />
      <Segments<Tab>
        items={[
          { key: "journey", label: r.tabs.journey },
          { key: "checkins", label: r.tabs.checkins },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "journey" ? <Journey items={journey} /> : <Checkins items={checkins} />}
    </Screen>
  );
}

/** Monday of a YYYY-MM-DD date (the server sends today's date in SAST). */
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

function CareBand({ checkin, onTaken }: { checkin: Checkin; onTaken: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Banner
      tone="needsYou"
      title={r.careTitle}
      testID="training-care-band"
      action={
        <Button
          label={busy ? r.careTaking : r.careTake}
          variant="secondary"
          loading={busy}
          disabled={busy}
          testID="training-care-take"
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await takeCare(apiFetch, checkin.id);
              onTaken();
            } catch (err) {
              setError(loadErrorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      }
    >
      {error ?? r.careBand(checkin.author.name)}
    </Banner>
  );
}

function Journey({ items }: { items: JourneyItem[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return <Text tone="secondary">{r.noJourney}</Text>;
  return (
    <View testID="training-journey">
      {items.map((it, i) => (
        <View
          key={`${it.kind}-${it.at}-${i}`}
          accessible
          style={{ flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: hairline, borderBottomColor: colors.rule }}
        >
          <Text variant="label" tone="secondary" style={{ width: 56 }}>
            {shortDate(it.at).toUpperCase()}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{it.title}</Text>
            {it.detail ? (
              <Text variant="caption" tone="secondary">
                {it.detail}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Checkins({ items }: { items: Checkin[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return <Text tone="secondary">{r.noCheckins}</Text>;
  return (
    <View testID="training-checkins" style={{ gap: 16 }}>
      {items.map((c) => (
        <View key={c.id} style={{ gap: 8, paddingBottom: 12, borderBottomWidth: hairline, borderBottomColor: colors.rule }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <Text variant="label">{`${r.weekOf(shortDate(c.weekOf))} · ${strings.contact[c.contact]}`.toUpperCase()}</Text>
            {c.mood ? <Tag>{strings.mood[c.mood]}</Tag> : null}
            {c.needsCare ? <Tag tone="danger">{strings.status.needs_care}</Tag> : null}
          </View>
          <Text variant="caption" tone="secondary">
            {r.by(c.author.name)}
            {c.careTaken ? ` · ${r.careTaken(c.careTaken.by)}` : ""}
          </Text>
          {c.noteForStudent ? (
            <View style={{ borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.surface, padding: 10, gap: 4 }}>
              <Text variant="label" tone="secondary">
                {r.forThem}
              </Text>
              <Text>{c.noteForStudent}</Text>
            </View>
          ) : null}
          {c.noteStaffOnly ? (
            <View style={{ backgroundColor: colors.inverse, padding: 10, gap: 4 }}>
              <Text variant="label" tone="onInverse">
                {r.staffOnly}
              </Text>
              <Text tone="onInverse">{c.noteStaffOnly}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
