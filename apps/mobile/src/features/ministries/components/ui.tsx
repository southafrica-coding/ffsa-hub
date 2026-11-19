// Ministries pieces for the redesign (frames 11.1–11.6) that the shared kit
// doesn't have: a section title with its count in a chip, and the saved-copy
// note. Built from kit components and tokens only.

import { View } from "react-native";

import { StatusChip, Text } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { StaleNote } from "@/features/finance/components/parts";
import type { LoadState } from "@/features/finance/use-cached-load";
import { space, touch } from "@/theme/tokens";

import { strings } from "../strings";

/** "Main ministries  [3]": a section title read with its count as one header. */
export function SectionCount({ title, count, tight = false }: { title: string; count: number; tight?: boolean }) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${title}, ${count}`}
      style={{
        minHeight: touch.floor,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        paddingTop: tight ? space.md : space.xl,
        paddingBottom: space.sm,
      }}
    >
      <Text variant="sectionTitle" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      <StatusChip label={String(count)} variant="quiet" icon={null} />
    </View>
  );
}

/**
 * When what's on screen is the copy saved on this phone: a quiet
 * "Last updated" line, or the offline note with a retry if a refresh failed.
 */
export function Freshness<T>({ state, onRetry }: { state: LoadState<T>; onRetry: () => void }) {
  if (state.status !== "ready" || state.staleSince === null) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) return <StaleNote message={strings.common.refreshFailed(when)} onRetry={onRetry} />;
  return (
    <Text variant="caption" tone="secondary" testID="last-updated" style={{ paddingHorizontal: space.xs }}>
      {strings.common.lastUpdated(when)}
    </Text>
  );
}
