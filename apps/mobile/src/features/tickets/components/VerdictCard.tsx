import { Ban, Check, CircleAlert, Clock, Repeat } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import type { TextTone } from "@/theme/styles";
import { hairline, radius, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { Verdict, VerdictIcon } from "../result";
import { strings } from "../strings";

const ICONS: Record<VerdictIcon, typeof Check> = {
  check: Check,
  repeat: Repeat,
  stop: Ban,
  alert: CircleAlert,
  clock: Clock,
};

type Props = {
  verdict: Verdict;
  undoOpen: boolean;
  onUndo: () => void;
  onDismiss: () => void;
  /** Label for the dismiss button ("Scan next" over the camera). */
  dismissLabel?: string;
};

/**
 * The big answer after a scan. Ink = in, yellow = already in, heavy outline
 * = don't admit, dashed = saved but NOT confirmed. Each also has its own icon
 * and words, so nobody needs to tell colours apart. Announced to screen
 * readers as it appears.
 */
export function VerdictCard({ verdict, undoOpen, onUndo, onDismiss, dismissLabel = strings.result.dismiss }: Props) {
  const { colors } = useTheme();
  const Icon = ICONS[verdict.icon];

  const look = {
    ink: { bg: colors.inverse, fg: colors.onInverse, border: colors.inverse, style: "solid" as const, tone: "onInverse" as const },
    accent: { bg: colors.accent, fg: colors.onAccent, border: colors.onAccent, style: "solid" as const, tone: "onAccent" as const },
    outline: { bg: colors.surface, fg: colors.text, border: colors.text, style: "solid" as const, tone: "default" as const },
    dashed: { bg: colors.bg, fg: colors.text, border: colors.text, style: "dashed" as const, tone: "default" as const },
  }[verdict.style];

  return (
    <View
      testID="verdict"
      accessibilityLiveRegion="assertive"
      style={{
        backgroundColor: look.bg,
        borderColor: look.border,
        borderWidth: verdict.style === "ink" ? 0 : 4,
        borderStyle: look.style,
        borderRadius: radius.none,
        padding: 20,
        gap: 12,
      }}
    >
      <View accessible accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Icon size={44} color={look.fg} strokeWidth={3} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" tone={look.tone} testID="verdict-title">
            {verdict.title}
          </Text>
          {verdict.detail ? (
            <Text tone={look.tone} testID="verdict-detail">
              {verdict.detail}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        {verdict.undoTicketId && undoOpen ? (
          <CardButton label={strings.result.undo} hint={strings.result.undoHint} onPress={onUndo} fg={look.fg} tone={look.tone} />
        ) : null}
        <CardButton label={dismissLabel} onPress={onDismiss} fg={look.fg} tone={look.tone} grow />
      </View>
    </View>
  );
}

/** Outline button in the card's own text colour, so it reads on ink, yellow or bone. */
function CardButton({
  label,
  hint,
  onPress,
  fg,
  tone,
  grow = false,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  fg: string;
  tone: TextTone;
  grow?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: touch.minTarget,
        minWidth: 96,
        flexGrow: grow ? 1 : 0,
        paddingHorizontal: 20,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: hairline * 2,
        borderColor: fg,
        borderRadius: radius.default,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text variant="label" tone={tone} style={{ fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}
