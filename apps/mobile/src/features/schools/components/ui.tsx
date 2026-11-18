// Small pieces the schools screens share. The general ones (section bar, tag,
// row, skeleton, error, stale note) are finance's, as Bookings reuses them;
// only what's specific to schools lives here.

import { ChevronRight } from "lucide-react-native";
import { View } from "react-native";

import { Text } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { StaleNote, Tag } from "@/features/finance/components/ui";
import type { LoadState } from "@/features/finance/use-cached-load";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { Tone } from "../logic";
import { strings } from "../strings";

/** A status word in a bordered tag: the word carries the meaning, colour only helps. */
export function StatusTag({ label, tone, testID }: { label: string; tone: Tone; testID?: string }) {
  return (
    <View testID={testID}>
      <Tag tone={tone}>{label}</Tag>
    </View>
  );
}

/**
 * When what's on screen is the copy saved on this phone: a quiet
 * "Last updated" line, or the stale note with a retry if a refresh failed.
 */
export function Freshness<T>({ state, onRetry }: { state: LoadState<T>; onRetry: () => void }) {
  if (state.status !== "ready" || state.staleSince === null) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) return <StaleNote message={strings.common.refreshFailed(when)} onRetry={onRetry} />;
  return (
    <Text variant="caption" tone="secondary" testID="last-updated">
      {strings.common.lastUpdated(when)}
    </Text>
  );
}

/** The trailing chevron on rows that open another screen in the app. */
export function Chevron() {
  const { colors } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <ChevronRight size={20} color={colors.textSecondary} />
    </View>
  );
}

/** Day + month stacked in a bordered square, like the web's DateBlock. */
export function DateBlock({ day, mon }: { day: string; mon: string }) {
  const { colors } = useTheme();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ minWidth: 48, paddingVertical: 4, paddingHorizontal: 6, alignItems: "center", borderWidth: hairline, borderColor: colors.text }}
    >
      <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
        {day}
      </Text>
      <Text variant="monoLabel" tone="secondary">
        {mon}
      </Text>
    </View>
  );
}

/** One figure in the grades strip: a mono label over a condensed numeral. */
export function Figure({ label, value, foot, big = false }: { label: string; value: string; foot?: string; big?: boolean }) {
  return (
    <View accessible accessibilityLabel={[label, value, foot].filter(Boolean).join(", ")} style={{ gap: 4, flexGrow: 1, flexBasis: big ? "100%" : 120 }}>
      <Text variant="monoLabel" tone="secondary">
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Text variant={big ? "numeral" : "title"} style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
        {foot ? (
          <Text variant="caption" tone="secondary">
            {foot}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
