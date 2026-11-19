// The pre-redesign pieces. My Schools and My History no longer use them (see
// parts.tsx); Ministries and Staff decisions still import these three until
// their own redesign slice moves to the kit, so they stay as they were.
// Delete this file once nothing imports it.

import { ChevronRight } from "lucide-react-native";
import { View } from "react-native";

import { Text } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { StaleNote, Tag } from "@/features/finance/components/ui";
import type { LoadState } from "@/features/finance/use-cached-load";
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
