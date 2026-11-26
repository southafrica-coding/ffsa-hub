import { useRouter } from "expo-router";
import { CalendarCheck, GraduationCap } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Bleed, EmptyState, FadeIn, Freshness, GroupRow, IconTile, LargeTitleScrollView, ListGroup, ListRow, LoadError, NeedsYouBand, SectionTitle, SkeletonList, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { StatusTag } from "../components/parts";
import { loadErrorMessage, loadSchools, type SchoolsList } from "../data";
import { applicationStatus, enrolmentStatus, formatDate, notYetApplied, staffName } from "../logic";
import { strings } from "../strings";
import type { Application, Enrolment, Programme } from "../types";

const s = strings.list;

// My Schools (frames 8.1, 8.4): the person's enrolments (each opens its
// detail), a way to their attendance, their applications, and schools open
// for applications. As on the web, the one yellow band is "a school is open
// that you haven't applied to"; applying itself happens on the website.
export default function SchoolsListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  const load = useCallback(() => (userId ? loadSchools(userId) : Promise.reject(new Error("signed out"))), [userId]);
  const { state, refreshing, refresh, retry } = useCachedLoad<SchoolsList>({
    userId,
    cacheName: "schools.list",
    load,
    errorMessage: loadErrorMessage,
  });

  const open = useCallback((path: string) => void openWebPage(path, colors), [colors]);
  const data = state.status === "ready" ? state.data : null;
  const unapplied = data ? notYetApplied(data.openProgrammes, data.applications) : [];

  const attendanceRow = (
    <ListRow
      icon={CalendarCheck}
      title={s.attendanceRow}
      subtitle={s.attendanceRowSub}
      onPress={() => router.push("/schools/attendance")}
      testID="attendance-row"
    />
  );

  return (
    <LargeTitleScrollView
      eyebrow={data?.enrolments.length ? `${s.context} · ${s.count(data.enrolments.length)}` : s.context}
      title={s.title}
      // My Schools is reached from Home (it isn't a tab), so it goes back to Home.
      back={{ label: strings.common.home, onPress: () => router.navigate("/") }}
      contentContainerStyle={{ flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
    >
      {state.status === "loading" ? (
        <Bleed>
          <SkeletonList label={s.loading} count={4} inset={false} />
        </Bleed>
      ) : null}
      {state.status === "error" ? (
        <Bleed>
          <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
        </Bleed>
      ) : null}
      <Freshness state={state} onRetry={retry} bleed />

      {/* The page's one yellow band, driven by the same data as the web's. */}
      {unapplied.length > 0 ? (
        <Bleed>
          <NeedsYouBand
            eyebrow={s.needsYouTitle}
            text={unapplied.length === 1 ? s.needsYouOne(unapplied[0].name) : s.needsYouMany(unapplied.length)}
            actionLabel={s.apply}
            actionAccessibilityHint={s.applyHint}
            onAction={() => open(unapplied.length === 1 ? `/my-schools/apply/${unapplied[0].id}` : "/my-schools")}
            testID="needs-you"
          />
        </Bleed>
      ) : null}

      {data ? (
        <FadeIn>
          <SectionTitle title={s.enrolments} meta={String(data.enrolments.length)} tight />
          <Bleed>
            <ListGroup inset={false}>
              {data.enrolments.length === 0 ? (
                <EmptyState
                  testID="empty"
                  card={false}
                  icon={GraduationCap}
                  title={s.emptyTitle}
                  body={s.emptyBody}
                  actionLabel={s.seeSchools}
                  onAction={() => open("/my-schools")}
                />
              ) : null}
              {data.enrolments.map((e) => (
                <EnrolmentRow key={e.id} enrolment={e} onPress={() => router.push({ pathname: "/schools/[id]", params: { id: e.id } })} />
              ))}
              {attendanceRow}
            </ListGroup>
          </Bleed>

          {data.applications.length > 0 ? (
            <>
              <SectionTitle title={s.applications} meta={String(data.applications.length)} />
              <Bleed>
                <ListGroup inset={false}>
                  {data.applications.map((a) => (
                    <ApplicationRow key={a.id} application={a} />
                  ))}
                </ListGroup>
              </Bleed>
            </>
          ) : null}

          {unapplied.length > 0 ? (
            <>
              <SectionTitle title={s.open} meta={String(unapplied.length)} />
              <Bleed>
                <ListGroup inset={false}>
                  {unapplied.map((p) => (
                    <OpenRow key={p.id} programme={p} onPress={() => open(`/my-schools/apply/${p.id}`)} />
                  ))}
                </ListGroup>
              </Bleed>
            </>
          ) : null}
        </FadeIn>
      ) : null}
    </LargeTitleScrollView>
  );
}

function EnrolmentRow({ enrolment: e, onPress }: { enrolment: Enrolment; onPress: () => void }) {
  const { colors } = useTheme();
  const status = enrolmentStatus(e.status);
  const name = e.programs?.name ?? s.programmeFallback;
  const staff = staffName(e.assigned_staff);
  const line = staff ? s.walkingWith(staff) : s.enrolled(formatDate(e.enrolled_at) ?? "");
  return (
    <GroupRow
      lead={
        <IconTile>
          <GraduationCap size={20} color={colors.text} />
        </IconTile>
      }
      onPress={onPress}
      accessibilityLabel={s.enrolmentA11y(name, status.label, line)}
      accessibilityHint={s.enrolmentHint}
      testID={`enrolment-${e.id}`}
    >
      <Text variant="rowTitle">{name}</Text>
      <Text variant="caption" tone="secondary">
        {line}
      </Text>
      <View style={{ marginTop: 6 }}>
        <StatusTag label={status.label} tone={status.tone} testID={`status-${e.status}`} />
      </View>
    </GroupRow>
  );
}

/** Read-only: an application has nothing to open in the app, so no chevron. */
function ApplicationRow({ application: a }: { application: Application }) {
  const status = applicationStatus(a.status);
  const name = a.programs?.name ?? s.programmeFallback;
  const staff = staffName(a.assigned_staff);
  const sent = formatDate(a.submitted_at);
  const line = staff ? s.walkingWith(staff) : sent ? s.submitted(sent) : (a.programs?.code ?? "");
  return (
    <GroupRow accessibilityLabel={[name, status.label, line].filter(Boolean).join(". ")} testID={`application-${a.id}`}>
      <Text variant="rowTitle">{name}</Text>
      {line ? (
        <Text variant="caption" tone="secondary">
          {line}
        </Text>
      ) : null}
      <View style={{ marginTop: 6 }}>
        <StatusTag label={status.label} tone={status.tone} />
      </View>
    </GroupRow>
  );
}

function OpenRow({ programme: p, onPress }: { programme: Programme; onPress: () => void }) {
  const sub = [p.code, p.credit_hours ? s.creditHours(p.credit_hours) : null].filter(Boolean).join(" · ");
  return <ListRow title={p.name} subtitle={sub || undefined} trailing="web" onPress={onPress} accessibilityHint={s.applyHint} testID={`open-${p.id}`} />;
}
