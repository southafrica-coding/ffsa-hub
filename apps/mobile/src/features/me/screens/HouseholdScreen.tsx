// Me › Household. The web's "My household" block (HouseholdMembers +
// HouseholdLinkCard): the family list, add spouse / add child (spouse only
// when married or not stated, same rule as the web), and leaving a shared
// family record. Members come from GET /api/profile/household; the person's
// own marital status and link date are read from their own users row (RLS).

import { useFocusEffect, useRouter } from "expo-router";
import { Baby, Heart, UserRound } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Text } from "@/components";
import { ListRow, SectionBar } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/theme/use-theme";

import { confirmDestructive, DocScreen, errorText, Intro, LoadGate, useLoad } from "../components/docs-ui";
import { getHousehold, leaveHousehold } from "../docs-api";
import { addableRelationships } from "../docs-logic";
import { profileFetch } from "../http";
import { meStrings } from "../strings";

const s = meStrings.docs.household;

export function memberRoute(params: { id?: string; relationship?: string }) {
  return { pathname: "/me/household-member" as const, params };
}

export function HouseholdScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const load = useLoad((signal) =>
    userId ? getHousehold(profileFetch, supabase, userId, signal) : Promise.reject(new Error("signed out")),
  );
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Coming back from the member screen: show what was saved.
  const first = useRef(true);
  const { refresh } = load;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const data = load.data;
  const addable = data ? addableRelationships(data.self.marital_status) : [];
  const what = addable.includes("spouse") ? s.addWhat.both : s.addWhat.child;

  async function leave() {
    if (!(await confirmDestructive(s.linked.confirmTitle, s.linked.confirmBody, s.linked.confirm))) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveHousehold(profileFetch);
      announce(s.linked.left);
      load.refresh();
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      setLeaveError(errorText(err, s.linked.error));
    } finally {
      setLeaving(false);
    }
  }

  return (
    <DocScreen refreshing={load.refreshing} onRefresh={load.refresh}>
      <Intro>{s.intro}</Intro>
      <LoadGate load={load} loadingLabel={s.loading} errorTitle={s.loadErrorTitle} />

      {data ? (
        <>
          {data.self.household_linked_at ? (
            <View testID="household-linked" style={{ gap: 8, padding: 12, backgroundColor: colors.surface }}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {s.linked.title}
              </Text>
              <Text tone="secondary">{s.linked.body}</Text>
              {leaveError ? (
                <Banner tone="danger" title={s.linked.error}>
                  {leaveError}
                </Banner>
              ) : null}
              <Button label={s.linked.leave} variant="secondary" onPress={() => void leave()} loading={leaving} />
            </View>
          ) : null}

          <View>
            <SectionBar label={s.title} />
            {data.members.length === 0 ? (
              <View style={{ paddingVertical: 16 }} testID="household-empty">
                <Text variant="bodyStrong">{s.empty}</Text>
                <Text tone="secondary">{s.emptyAdd(what)}</Text>
              </View>
            ) : (
              data.members.map((m) => {
                const rel = s.relationship[m.relationship] ?? m.relationship;
                return (
                  <ListRow
                    key={m.id}
                    testID={`member-${m.id}`}
                    icon={m.relationship === "spouse" ? Heart : m.relationship === "child" ? Baby : UserRound}
                    title={m.full_name || rel}
                    subtitle={rel}
                    accessibilityHint={s.editHint}
                    onPress={() => router.push(memberRoute({ id: m.id }))}
                  />
                );
              })
            )}
          </View>

          <View style={{ gap: 8 }}>
            {addable.includes("spouse") ? (
              <Button label={s.addSpouse} variant="secondary" onPress={() => router.push(memberRoute({ relationship: "spouse" }))} />
            ) : null}
            <Button label={s.addChild} variant="secondary" onPress={() => router.push(memberRoute({ relationship: "child" }))} />
          </View>
        </>
      ) : null}
    </DocScreen>
  );
}
