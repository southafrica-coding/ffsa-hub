// Home's own building blocks: the skeleton that holds the whole feed layout
// as ONE progress element, and the pull-to-refresh tap. (The band and the
// "Mark all read" header are the kit's NeedsYouBand and SectionHeader.)

import * as Haptics from "expo-haptics";
import { View } from "react-native";

import { Skeleton } from "@/components";
import { hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// ── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRows({ count }: { count: number }) {
  const { colors } = useTheme();
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            minHeight: 60,
            flexDirection: "row",
            gap: space.md,
            paddingVertical: space.md,
            paddingHorizontal: space.xs,
            borderBottomWidth: hairline,
            borderBottomColor: colors.rule,
          }}
        >
          <Skeleton width={36} height={36} />
          <View style={{ flex: 1, gap: space.sm, justifyContent: "center" }}>
            <Skeleton width={i % 2 ? "55%" : "62%"} />
            <Skeleton width={i % 2 ? "80%" : "72%"} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Home while the first feed loads: the band, two section titles and their
 * rows, in the real layout. Read as one labelled progress element.
 */
export function HomeSkeleton({ label, bleed }: { label: string; bleed: number }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} testID="home-skeleton">
      <View style={{ marginHorizontal: bleed }}>
        <Skeleton height={68} rounded="card" />
      </View>
      <View style={{ paddingTop: space.xl, paddingBottom: space.lg }}>
        <Skeleton width={90} />
      </View>
      <SkeletonRows count={3} />
      <View style={{ paddingTop: space.xl, paddingBottom: space.lg }}>
        <Skeleton width={70} />
      </View>
      <SkeletonRows count={3} />
    </View>
  );
}

// ── Haptics ─────────────────────────────────────────────────────────────────

/** Light tap when pull-to-refresh triggers. Never throws: haptics are a nicety. */
export function refreshHaptic() {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // No haptics engine (simulator, tests): nothing to do.
  }
}
