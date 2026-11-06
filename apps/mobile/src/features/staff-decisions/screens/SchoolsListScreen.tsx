import { useRouter } from "expo-router";
import { UserCheck } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Masthead, Screen, Text } from "@/components";
import { ErrorState, Row, SectionBar, Skeleton } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { Chevron, Freshness, StatusTag } from "@/features/schools/components/ui";
import { StateMessage } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { getSchools, loadErrorMessage, type School, type SchoolList } from "../api";
import { Counts } from "../components/Counts";
import { schoolA11yLabel } from "../logic";
import { strings } from "../strings";

const s = strings.list;

// Staff decisions: every Leadership Track school (archived ones too, since
// this access never expires) with its Students / Yes / No / Undecided
// counts, the web /staff-decisions table as rows. Each opens its students.
// No yellow band here: the web list has none; the school page carries it.
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
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <Masthead context={s.context} title={s.title} />

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {forbidden ? (
          <StateMessage testID="forbidden" icon={UserCheck} title={strings.gate.title} body={strings.common.forbidden} />
        ) : state.status === "error" ? (
          <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} />
        ) : null}
        <Freshness state={state} onRetry={retry} />

        {data ? (
          <>
            <Text tone="secondary">{s.intro}</Text>
            {data.schools.length === 0 ? (
              <StateMessage testID="empty" icon={UserCheck} title={s.emptyTitle} body={s.emptyBody} />
            ) : (
              <View>
                <SectionBar title={s.title} meta={String(data.schools.length)} />
                {data.schools.map((school) => (
                  <SchoolRow
                    key={school.id}
                    school={school}
                    onPress={() => router.push({ pathname: "/staff-decisions/[programId]", params: { programId: school.id } })}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SchoolRow({ school, onPress }: { school: School; onPress: () => void }) {
  return (
    <Row onPress={onPress} accessibilityLabel={schoolA11yLabel(school)} accessibilityHint={s.rowHint} testID={`school-${school.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text variant="title">{school.name}</Text>
          {school.archived ? <StatusTag label={s.archived} tone="default" testID={`archived-${school.id}`} /> : null}
          <Counts total={school.total} yes={school.yes} no={school.no} undecided={school.undecided} />
        </View>
        <Chevron />
      </View>
    </Row>
  );
}
