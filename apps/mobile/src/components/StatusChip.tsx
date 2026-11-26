import { Check, CircleDashed, CircleDot, Info, TriangleAlert, X, type LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import { chipStyle, type ChipVariant } from "@/theme/styles";
import { fontFamily, fontSize } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Text } from "./Text";

const DEFAULT_ICON: Record<ChipVariant, LucideIcon | null> = {
  positive: Check,
  attention: TriangleAlert,
  danger: X,
  ink: CircleDot,
  quiet: Info,
  dashed: CircleDashed,
  // Neutral chips carry whatever icon the caller passes (e.g. a clock).
  neutral: null,
};

export type StatusChipProps = {
  /** The word. Status is never colour alone. */
  label: string;
  variant?: ChipVariant;
  /** Replace the variant's icon, or pass null for a word-only chip (e.g. "You", "Staff"). */
  icon?: LucideIcon | null;
  /** Spoken instead of the word, if it needs more context ("Status: paid"). */
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * 24pt chip, 6pt radius, 1px currentColor border, icon + word.
 * positive (Paid) · attention (Due soon) · danger (Cancelled) · ink (You) ·
 * quiet (Staff) · dashed (Needs a lead) · neutral.
 */
export function StatusChip({ label, variant = "neutral", icon, accessibilityLabel, testID }: StatusChipProps) {
  const { colors } = useTheme();
  const s = chipStyle(variant, colors);
  const Icon = icon === null ? null : (icon ?? DEFAULT_ICON[variant]);
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? label} style={[s.container, { maxWidth: "100%" }]}>
      {Icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon size={14} color={s.color} strokeWidth={2.25} />
        </View>
      ) : null}
      {/* Never wider than its row: at the largest text the word wraps inside the chip (QA pass 2). */}
      <Text style={{ fontFamily: fontFamily.bodySemibold, fontSize: fontSize.chip, lineHeight: 16, color: s.color, flexShrink: 1 }}>{label}</Text>
    </View>
  );
}
