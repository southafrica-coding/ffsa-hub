// Home's own building blocks, for the places where the kit doesn't fit yet
// (see the "Kit follow-ups" in the Mobile R: Sign-in, splash and Home PR):
//  - the band needs a second line and an Open button that names its item;
//  - "Mark all read" needs its own VoiceOver label;
//  - the skeleton holds the whole feed layout as ONE progress element.
// Styled like the kit so they can be folded into it later.

import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";

import { Skeleton, Text } from "@/components";
import { useRegisterNeedsYouBand } from "@/components/Screen";
import { needsYouBandStyle } from "@/theme/styles";
import { fontFamily, fontSize, hairline, palette, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// ── Needs you band ──────────────────────────────────────────────────────────

/**
 * THE yellow band on Home: eyebrow, the count, the first unread title, Open.
 * Counts as the screen's one band (it registers like the kit's NeedsYouBand).
 */
export function HomeNeedsYouBand({
  eyebrow,
  text,
  detail,
  actionLabel,
  actionAccessibilityLabel,
  onAction,
  testID,
}: {
  eyebrow: string;
  text: string;
  detail: string;
  actionLabel: string;
  actionAccessibilityLabel: string;
  onAction: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  useRegisterNeedsYouBand(true);
  return (
    <View testID={testID} style={{ ...needsYouBandStyle(colors), flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.md }}>
      <View accessible accessibilityRole="summary" accessibilityLabel={`${eyebrow}. ${text}. ${detail}`} style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <Text variant="eyebrow" tone="onAccent">
          {eyebrow}
        </Text>
        <Text variant="rowTitle" tone="onAccent">
          {text}
        </Text>
        <Text tone="onAccent" style={{ fontSize: fontSize.sectionTitle, lineHeight: 22 }}>
          {detail}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionAccessibilityLabel}
        onPress={onAction}
        style={({ pressed }) => ({
          minHeight: touch.floor,
          minWidth: touch.floor,
          paddingHorizontal: space.lg,
          borderRadius: radius.control,
          alignItems: "center",
          justifyContent: "center",
          // Black button with a white label in both schemes: it sits on yellow.
          backgroundColor: palette.ink,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text variant="sectionTitle" style={{ color: palette.white, fontFamily: fontFamily.bodyBold }}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

// ── Section header with a labelled action ───────────────────────────────────

/** The kit's SectionHeader, plus a VoiceOver label and testID for the action. */
export function FeedSectionHeader({
  title,
  actionLabel,
  actionAccessibilityLabel,
  actionTestID,
  onAction,
}: {
  title: string;
  actionLabel: string;
  actionAccessibilityLabel: string;
  actionTestID?: string;
  onAction: () => void;
}) {
  return (
    <View
      style={{
        minHeight: touch.floor,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        paddingTop: space.xl,
        paddingBottom: space.sm,
      }}
    >
      <Text variant="sectionTitle" tone="default" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      <Pressable
        testID={actionTestID}
        accessibilityRole="button"
        accessibilityLabel={actionAccessibilityLabel}
        onPress={onAction}
        hitSlop={4}
        style={({ pressed }) => ({ minHeight: touch.floor, justifyContent: "center", paddingLeft: space.md, opacity: pressed ? 0.6 : 1 })}
      >
        <Text variant="sectionTitle" tone="default" style={{ textDecorationLine: "underline" }}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

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
