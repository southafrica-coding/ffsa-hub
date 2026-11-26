import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import {
  Bleed,
  Button,
  FadeIn,
  Freshness,
  GroupRow,
  LargeTitleScrollView,
  ListGroup,
  LoadError,
  NeedsYouBand,
  PushedPage,
  SegmentedControl,
  SkeletonList,
  StatusChip,
  Text,
} from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { apiFetch } from "@/lib/api-client";
import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { getStudent, loadErrorMessage, takeCare, type Checkin, type JourneyItem, type StudentRecord } from "../api";
import { STATUS_CHIP } from "../components/StudentsSection";
import { shortDate } from "../logic";
import { strings } from "../strings";

const r = strings.record;
type Tab = "journey" | "checkins";

// One student (48c + 48d): large title, who walks with them, a Check in
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
  const back = { label: strings.back, onPress: () => router.back() };

  // Back from the check-in form: show what was just saved.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  if (state.status === "loading") {
    return (
      <PushedPage back={back}>
        <Bleed>
          <SkeletonList label={r.loading} inset={false} count={5} />
        </Bleed>
      </PushedPage>
    );
  }
  if (state.status === "error") {
    return (
      <PushedPage back={back}>
        <Bleed>
          <LoadError testID="training-student-error" title={r.errorTitle} message={state.message} onRetry={retry} />
        </Bleed>
      </PushedPage>
    );
  }

  const { student, checkins, journey, today } = state.data;
  const openCare = checkins.find((c) => c.needsCare && !c.careTaken) ?? null;
  const mineThisWeek = checkins.some((c) => c.mine && today && c.weekOf === mondayOf(today));
  const status = STATUS_CHIP[student.status];

  return (
    <LargeTitleScrollView
      back={back}
      eyebrow={student.programName ?? undefined}
      tick={false}
      title={student.name}
    >
      <FadeIn style={{ gap: space.lg }}>
        <Freshness state={state} onRetry={retry} bleed />
        {openCare ? <CareBand checkin={openCare} onTaken={refresh} /> : null}
        <View style={{ gap: space.sm, alignItems: "flex-start" }}>
          <StatusChip label={strings.status[student.status]} variant={status.variant} icon={status.icon} />
          <Text tone="secondary">{strings.list.walkingWith(student.walkers.map((w) => w.name))}</Text>
        </View>
        <Button
          label={mineThisWeek ? r.checkInAgain : r.checkIn}
          onPress={() => router.push({ pathname: "/training/checkin/[id]", params: { id, name: student.name } })}
          testID="training-checkin-open"
        />
        <SegmentedControl<Tab>
          inset={false}
          items={[
            { key: "journey", label: r.tabs.journey },
            { key: "checkins", label: r.tabs.checkins },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "journey" ? <Journey items={journey} /> : <Checkins items={checkins} />}
      </FadeIn>
    </LargeTitleScrollView>
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
    <Bleed>
      <NeedsYouBand
        testID="training-care-band"
        eyebrow={r.careTitle}
        text={error ?? r.careBand(checkin.author.name)}
        actionLabel={busy ? r.careTaking : r.careTake}
        onAction={async () => {
          if (busy) return;
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
    </Bleed>
  );
}

function Journey({ items }: { items: JourneyItem[] }) {
  if (items.length === 0) return <Text tone="secondary">{r.noJourney}</Text>;
  return (
    <Bleed>
      <ListGroup inset={false} testID="training-journey">
        {items.map((it, i) => (
          <GroupRow
            key={`${it.kind}-${it.at}-${i}`}
            accessibilityLabel={[shortDate(it.at), it.title, it.detail].filter(Boolean).join(". ")}
            lead={
              <Text variant="label" style={{ width: 56 }}>
                {shortDate(it.at)}
              </Text>
            }
          >
            <Text variant="rowTitle">{it.title}</Text>
            {it.detail ? (
              <Text variant="caption" tone="secondary">
                {it.detail}
              </Text>
            ) : null}
          </GroupRow>
        ))}
      </ListGroup>
    </Bleed>
  );
}

/**
 * Each check-in with its two notes, which look nothing alike on purpose:
 * the note the student reads has a yellow rule; the staff-only note is an
 * ink panel.
 */
function Checkins({ items }: { items: Checkin[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return <Text tone="secondary">{r.noCheckins}</Text>;
  return (
    <Bleed>
      <ListGroup inset={false} testID="training-checkins">
        {items.map((c) => (
          <View key={c.id} style={{ gap: space.sm, paddingVertical: space.md, paddingHorizontal: space.lg }}>
            <Text variant="rowTitle">{`${r.weekOf(shortDate(c.weekOf))} · ${strings.contact[c.contact]}`}</Text>
            {c.mood || c.needsCare ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {c.mood ? <StatusChip label={strings.mood[c.mood]} icon={null} /> : null}
                {c.needsCare ? (
                  <StatusChip label={strings.status.needs_care} variant={STATUS_CHIP.needs_care.variant} icon={STATUS_CHIP.needs_care.icon} />
                ) : null}
              </View>
            ) : null}
            <Text variant="caption" tone="secondary">
              {r.by(c.author.name)}
              {c.careTaken ? ` · ${r.careTaken(c.careTaken.by)}` : ""}
            </Text>
            {c.noteForStudent ? (
              <View
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: colors.accent,
                  borderRadius: radius.control,
                  borderWidth: hairline,
                  borderColor: colors.rule,
                  backgroundColor: colors.surface,
                  padding: space.md,
                  gap: space.xs,
                }}
              >
                <Text variant="label">{r.forThem}</Text>
                <Text>{c.noteForStudent}</Text>
              </View>
            ) : null}
            {c.noteStaffOnly ? (
              <View style={{ backgroundColor: colors.inverse, borderRadius: radius.control, padding: space.md, gap: space.xs }}>
                <Text variant="label" tone="onInverse">
                  {r.staffOnly}
                </Text>
                <Text tone="onInverse">{c.noteStaffOnly}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </ListGroup>
    </Bleed>
  );
}
