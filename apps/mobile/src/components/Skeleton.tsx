import { useEffect, useState } from "react";
import { Animated, View, type DimensionValue } from "react-native";

import { useReduceMotion } from "@/lib/a11y";
import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { kitStrings } from "./strings";

/** A soft 1.2s pulse; static under Reduce Motion. */
function usePulse() {
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, opacity]);
  return { opacity, reduceMotion };
}

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  /** 6 for text blocks, 8 for card blocks. */
  rounded?: "control" | "card";
};

/** One placeholder block. Group several inside SkeletonList (or your own labelled progressbar). */
export function Skeleton({ width = "100%", height = 14, rounded = "control" }: SkeletonProps) {
  const { colors } = useTheme();
  const { opacity } = usePulse();
  return (
    <Animated.View
      testID="skeleton-block"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius[rounded], backgroundColor: colors.surfaceStrong, opacity }}
    />
  );
}

/**
 * Skeleton rows in the final list layout (a ListGroup of rows), read as one
 * labelled progress element ("Loading your tickets").
 */
export function SkeletonList({ count = 3, label = kitStrings.loading, inset = true }: { count?: number; label?: string; inset?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      testID="skeleton"
      style={{
        marginHorizontal: inset ? space.inset : 0,
        borderWidth: hairline,
        borderColor: colors.rule,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            minHeight: 56,
            justifyContent: "center",
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            borderTopWidth: i > 0 ? hairline : 0,
            borderTopColor: colors.rule,
          }}
        >
          <Skeleton width={i % 2 ? "55%" : "62%"} />
          <Skeleton width={i % 2 ? "35%" : "40%"} height={11} />
        </View>
      ))}
    </View>
  );
}
