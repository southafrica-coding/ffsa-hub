import { useRouter } from "expo-router";
import { ChevronRight, SunMedium } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Text } from "@/components";
import { ErrorState, Skeleton } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage, SectionBar, setTabBadge as updateTabBadge, StateMessage } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { loadErrorMessage } from "../api";
import type { StudentFilter } from "../logic";
import { strings } from "../strings";
import { getToday, setTodayDone, withDone, type Today, type TodayItem, type TodayTarget } from "../today";

const t = strings.today;

// Today (48a): the one yellow band for the most urgent open item, then the
// list. Ticking an item hides it for the week (it can be unticked); tapping
// the line opens the screen that does the work. Sets the Training tab badge.
export function TodaySection({ onOpenStudents }: { onOpenStudents: (filter: StudentFilter) => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const load = useCallback(() => getToday(apiFetch), []);
  const { state, retry } = useCachedLoad<Today>({ userId, cacheName: "training.today", load, errorMessage: loadErrorMessage });
  // Ticks show at once (optimistic). The override only applies to the copy it
  // was made from, so a fresh load from the server replaces it by itself.
  const [override, setOverride] = useState<{ base: Today; value: Today } | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);

  const fresh = state.status === "ready" ? state.data : null;
  const data = override && override.base === fresh ? override.value : fresh;
  const openCount = data?.open ?? null;
  useEffect(() => {
    if (openCount !== null) updateTabBadge("training", openCount);
  }, [openCount]);

  const open = useCallback(
    (target: TodayTarget) => {
      if (target.type === "student") router.push({ pathname: "/training/student/[id]", params: { id: target.enrollmentId } });
      else if (target.type === "students") onOpenStudents(target.filter);
      else void openWebPage(target.path, colors);
    },
    [router, onOpenStudents, colors],
  );

  if (state.status === "loading" && !data) return <Skeleton label={t.loading} />;
  if (state.status === "error" && !data) return <ErrorState title={t.errorTitle} message={state.message} onRetry={retry} />;
  if (!data) return null;

  if (data.items.length === 0) {
    return <StateMessage testID="training-today-clear" icon={SunMedium} title={t.clearTitle} body={t.clearBody} />;
  }

  const band = data.items.find((i) => i.key === data.band) ?? null;

  async function tick(item: TodayItem) {
    if (!data || !fresh) return;
    const before = data;
    setTickError(null);
    setOverride({ base: fresh, value: withDone(before, item.key, !item.done) });
    try {
      await setTodayDone(apiFetch, item.key, !item.done);
    } catch (err) {
      setOverride({ base: fresh, value: before });
      setTickError(loadErrorMessage(err));
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {band ? (
        <Banner
          tone="needsYou"
          title={t.bandTitle}
          testID="training-today-band"
          action={<Button label={t.open} variant="secondary" onPress={() => open(band.target)} testID="training-today-band-open" />}
        >
          {`${band.title} · ${band.meta}`}
        </Banner>
      ) : null}
      <SectionBar label={t.listTitle(data.open)} />
      {tickError ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {tickError}
        </Text>
      ) : null}
      <View>
        {data.items.map((item) => (
          <TodayRow key={item.key} item={item} onTick={() => tick(item)} onOpen={() => open(item.target)} />
        ))}
      </View>
    </View>
  );
}

function TodayRow({ item, onTick, onOpen }: { item: TodayItem; onTick: () => void; onOpen: () => void }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: hairline,
        borderBottomColor: colors.rule,
        opacity: item.done ? 0.55 : 1,
      }}
    >
      <Pressable
        testID={`training-today-tick-${item.key}`}
        accessibilityRole="checkbox"
        accessibilityLabel={t.tickLabel(item.title)}
        accessibilityState={{ checked: item.done }}
        onPress={onTick}
        hitSlop={4}
        style={{ width: touch.minTarget, minHeight: touch.minTarget, alignItems: "center", justifyContent: "center" }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderWidth: 2,
            borderColor: colors.text,
            backgroundColor: item.done ? colors.inverse : "transparent",
          }}
        />
      </Pressable>
      <Pressable
        testID={`training-today-open-${item.key}`}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={item.meta}
        onPress={onOpen}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 64,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 10,
          paddingRight: 4,
          backgroundColor: pressed ? colors.surface : "transparent",
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" style={item.done ? { textDecorationLine: "line-through" } : undefined}>
            {item.title}
          </Text>
          <Text variant="caption" tone="secondary">
            {item.meta}
          </Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChevronRight size={20} color={colors.textSecondary} />
        </View>
      </Pressable>
    </View>
  );
}
