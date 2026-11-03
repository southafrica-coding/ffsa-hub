import { useRouter } from "expo-router";
import { CalendarCheck, GraduationCap } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Masthead, Screen, Text } from "@/components";
import { ErrorState, Row, SectionBar, Skeleton } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { ListRow, StateMessage, openWebPage } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

import { Chevron, Freshness, StatusTag } from "../components/ui";
import { loadErrorMessage, loadSchools, type SchoolsList } from "../data";
import { applicationStatus, enrolmentStatus, formatDate, notYetApplied, staffName } from "../logic";
import { strings } from "../strings";
import type { Application, Enrolment, Programme } from "../types";

const s = strings.list;

// My Schools: the person's enrolments (each opens its detail), a way to their
// attendance, their applications, and schools open for applications. As on
// the web, the one yellow band is "a school is open that you haven't applied
// to"; applying itself happens on the website.
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

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} colors={[colors.text]} />}
      >
        <Masthead context={data ? `${s.context} · ${data.enrolments.length}` : s.context} title={s.title} />

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {state.status === "error" ? <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} /> : null}
        <Freshness state={state} onRetry={retry} />

        {/* The page's one yellow band, driven by the same data as the web's. */}
        {unapplied.length > 0 ? (
          <Banner
            tone="needsYou"
            title={s.needsYouTitle}
            testID="needs-you"
            action={
              <Button
                label={s.apply}
                variant="primary"
                accessibilityHint={s.applyHint}
                onPress={() => open(unapplied.length === 1 ? `/my-schools/apply/${unapplied[0].id}` : "/my-schools")}
              />
            }
          >
            {unapplied.length === 1 ? s.needsYouOne(unapplied[0].name) : s.needsYouMany(unapplied.length)}
          </Banner>
        ) : null}

        {data ? (
          <>
            <View>
              <SectionBar title={s.enrolments} meta={String(data.enrolments.length)} />
              {data.enrolments.length === 0 ? (
                <StateMessage
                  testID="empty"
                  icon={GraduationCap}
                  title={s.emptyTitle}
                  body={s.emptyBody}
                  actionLabel={s.seeSchools}
                  onAction={() => open("/my-schools")}
                />
              ) : (
                data.enrolments.map((e) => (
                  <EnrolmentRow key={e.id} enrolment={e} onPress={() => router.push({ pathname: "/schools/[id]", params: { id: e.id } })} />
                ))
              )}
              <ListRow
                icon={CalendarCheck}
                title={s.attendanceRow}
                subtitle={s.attendanceRowSub}
                onPress={() => router.push("/schools/attendance")}
                testID="attendance-row"
              />
            </View>

            {data.applications.length > 0 ? (
              <View>
                <SectionBar title={s.applications} meta={String(data.applications.length)} />
                {data.applications.map((a) => (
                  <ApplicationRow key={a.id} application={a} />
                ))}
              </View>
            ) : null}

            {unapplied.length > 0 ? (
              <View>
                <SectionBar title={s.open} meta={String(unapplied.length)} />
                {unapplied.map((p) => (
                  <OpenRow key={p.id} programme={p} onPress={() => open(`/my-schools/apply/${p.id}`)} />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function EnrolmentRow({ enrolment: e, onPress }: { enrolment: Enrolment; onPress: () => void }) {
  const status = enrolmentStatus(e.status);
  const name = e.programs?.name ?? s.programmeFallback;
  const staff = staffName(e.assigned_staff);
  const line = staff ? s.walkingWith(staff) : s.enrolled(formatDate(e.enrolled_at) ?? "");
  return (
    <Row onPress={onPress} accessibilityLabel={s.enrolmentA11y(name, status.label, line)} accessibilityHint={s.enrolmentHint} testID={`enrolment-${e.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title">{name}</Text>
          <Text variant="caption" tone="secondary">
            {line}
          </Text>
          <StatusTag label={status.label} tone={status.tone} testID={`status-${e.status}`} />
        </View>
        <Chevron />
      </View>
    </Row>
  );
}

function ApplicationRow({ application: a }: { application: Application }) {
  const status = applicationStatus(a.status);
  const name = a.programs?.name ?? s.programmeFallback;
  const staff = staffName(a.assigned_staff);
  const sent = formatDate(a.submitted_at);
  const line = staff ? s.walkingWith(staff) : sent ? s.submitted(sent) : (a.programs?.code ?? "");
  return (
    <Row accessibilityLabel={[name, status.label, line].filter(Boolean).join(". ")} testID={`application-${a.id}`}>
      <Text variant="bodyStrong">{name}</Text>
      {line ? (
        <Text variant="caption" tone="secondary">
          {line}
        </Text>
      ) : null}
      <StatusTag label={status.label} tone={status.tone} />
    </Row>
  );
}

function OpenRow({ programme: p, onPress }: { programme: Programme; onPress: () => void }) {
  const sub = [p.code, p.credit_hours ? s.creditHours(p.credit_hours) : null].filter(Boolean).join(" · ");
  return <ListRow title={p.name} subtitle={sub || undefined} trailing="web" onPress={onPress} accessibilityHint={s.applyHint} testID={`open-${p.id}`} />;
}
