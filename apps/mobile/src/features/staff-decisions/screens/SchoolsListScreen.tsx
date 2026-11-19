import { useRouter } from "expo-router";
import { Lock, UserCheck } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Bleed, EmptyState, Freshness, GroupRow, LargeTitleScrollView, ListGroup, LoadError, SkeletonList, StatusChip, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { apiFetch } from "@/lib/api-client";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { getSchools, loadErrorMessage, type School, type SchoolList } from "../api";
import { schoolA11yLabel } from "../logic";
import { strings } from "../strings";

const s = strings.list;

// Staff decisions: every Leadership Track school (archived ones too, since
// this access never expires) with its students / yes / no / undecided
// counts in one line, the web /staff-decisions table as rows. Each opens its
// students. No yellow band here: the web list has none; the school page
// carries it.
export default function SchoolsListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  const load = useCallback(() => getSchools(apiFetch), []);
  const { state, refreshing, refresh, retry } = useCachedLoad<SchoolList>({
    userId,
    cacheName: "staff-decisions.list",
    load,
    errorMessage: loadErrorMessage,
  });

  const data = state.status === "ready" ? state.data : null;
  const forbidden = state.status === "error" && state.message === strings.common.forbidden;

  return (
    <LargeTitleScrollView
      // Staff decisions is reached from Home (it isn't a tab), so the list goes back to Home.
      back={{ label: strings.common.home, onPress: () => router.navigate("/") }}
      eyebrow={s.context}
      title={s.title}
      gap={0}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
    >
      {data ? (
        <Text variant="caption" tone="secondary" style={{ marginTop: -space.sm, marginBottom: space.lg }}>
          {s.intro}
        </Text>
      ) : null}

      <Bleed style={{ gap: space.md }}>
        {state.status === "loading" ? <SkeletonList label={s.loading} count={3} inset={false} /> : null}
        {forbidden ? (
          <EmptyState testID="forbidden" icon={Lock} title={strings.gate.title} body={strings.common.forbidden} />
        ) : state.status === "error" ? (
          <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
        ) : null}
        <Freshness state={state} onRetry={retry} />

        {data ? (
          data.schools.length === 0 ? (
            <EmptyState testID="empty" icon={UserCheck} title={s.emptyTitle} body={s.emptyBody} />
          ) : (
            <ListGroup inset={false}>
              {data.schools.map((school) => (
                <SchoolRow
                  key={school.id}
                  school={school}
                  onPress={() => router.push({ pathname: "/staff-decisions/[programId]", params: { programId: school.id } })}
                />
              ))}
            </ListGroup>
          )
        ) : null}
      </Bleed>
    </LargeTitleScrollView>
  );
}

function SchoolRow({ school, onPress }: { school: School; onPress: () => void }) {
  return (
    <GroupRow onPress={onPress} accessibilityLabel={schoolA11yLabel(school)} accessibilityHint={s.rowHint} testID={`school-${school.id}`}>
      {/* Archived sits at the trailing edge, and drops under a long name rather than squeezing it. */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: space.sm, rowGap: space.xs }}>
        <Text variant="rowTitle" style={{ flexShrink: 1 }}>
          {school.name}
        </Text>
        {school.archived ? <StatusChip label={s.archived} variant="quiet" icon={null} testID={`archived-${school.id}`} /> : null}
      </View>
      <Text variant="caption" tone="secondary" style={{ fontVariant: ["tabular-nums"] }}>
        {s.rowSummary(school.total, school.yes, school.no, school.undecided)}
      </Text>
    </GroupRow>
  );
}
