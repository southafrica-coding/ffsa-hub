import { useRouter } from "expo-router";
import { Check, ChevronRight, SunMedium } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Pressable } from "@/components/Pressable";

import { useSession } from "@/auth/session-provider";
import { Bleed, EmptyState, FadeIn, FieldError, Freshness, ListGroup, LoadError, NeedsYouBand, SectionTitle, SkeletonList, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage, setTabBadge as updateTabBadge } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { radius, space, touch } from "@/theme/tokens";
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

  if (state.status === "loading" && !data) {
    return (
      <Bleed>
        <SkeletonList label={t.loading} inset={false} />
      </Bleed>
    );
  }
  if (state.status === "error" && !data) {
    return (
      <Bleed>
        <LoadError testID="training-today-error" title={t.errorTitle} message={state.message} onRetry={retry} />
      </Bleed>
    );
  }
  if (!data) return null;

  if (data.items.length === 0) {
    return (
      <FadeIn style={{ gap: space.lg }}>
        <Freshness state={state} onRetry={retry} bleed />
        <Bleed>
          <EmptyState testID="training-today-clear" icon={SunMedium} title={t.clearTitle} body={t.clearBody} />
        </Bleed>
      </FadeIn>
    );
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
    <FadeIn style={{ gap: space.lg }}>
      <Freshness state={state} onRetry={retry} bleed />
      {band ? (
        <Bleed>
          <NeedsYouBand
            testID="training-today-band"
            eyebrow={t.bandTitle}
            text={`${band.title} · ${band.meta}`}
            actionLabel={t.open}
            actionAccessibilityLabel={`${t.open}: ${band.title}`}
            onAction={() => open(band.target)}
          />
        </Bleed>
      ) : null}
      <View>
        <SectionTitle title={t.listTitle(data.open)} tight />
        {tickError ? (
          <View accessibilityLiveRegion="polite" style={{ paddingBottom: space.sm }}>
            <FieldError>{tickError}</FieldError>
          </View>
        ) : null}
        <Bleed>
          <ListGroup inset={false}>
            {data.items.map((item) => (
              <TodayRow key={item.key} item={item} onTick={() => tick(item)} onOpen={() => open(item.target)} />
            ))}
          </ListGroup>
        </Bleed>
      </View>
    </FadeIn>
  );
}

/** A tick box (done for the week) and the line that opens the work: two separate targets. */
function TodayRow({ item, onTick, onOpen }: { item: TodayItem; onTick: () => void; onOpen: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "stretch", opacity: item.done ? 0.6 : 1 }}>
      <Pressable
        testID={`training-today-tick-${item.key}`}
        accessibilityRole="checkbox"
        accessibilityLabel={t.tickLabel(item.title)}
        accessibilityState={{ checked: item.done }}
        onPress={onTick}
        style={({ pressed }) => ({
          width: touch.minTarget + space.sm,
          minHeight: touch.minTarget,
          alignItems: "center",
          justifyContent: "center",
          paddingLeft: space.xs,
          backgroundColor: pressed ? colors.surfaceStrong : "transparent",
        })}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 22,
            height: 22,
            borderRadius: radius.control,
            borderWidth: 1.5,
            borderColor: item.done ? colors.primary : colors.ruleStrong,
            backgroundColor: item.done ? colors.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {item.done ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
        </View>
      </Pressable>
      <Pressable
        testID={`training-today-open-${item.key}`}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={item.meta}
        onPress={onOpen}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingVertical: 10,
          paddingRight: space.md,
          backgroundColor: pressed ? colors.surfaceStrong : "transparent",
        })}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="rowTitle" style={item.done ? { textDecorationLine: "line-through" } : undefined}>
            {item.title}
          </Text>
          <Text variant="caption" tone="secondary">
            {item.meta}
          </Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChevronRight size={18} color={colors.textTertiary} />
        </View>
      </Pressable>
    </View>
  );
}
