import { Check, Clock, RefreshCw, TriangleAlert, X, type LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { fontFamily, fontSize, radius, space, touch, type SemanticColors } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { Verdict, VerdictIcon } from "../result";
import { strings } from "../strings";

const ICONS: Record<VerdictIcon, LucideIcon> = {
  check: Check,
  repeat: RefreshCw,
  stop: X,
  alert: TriangleAlert,
  clock: Clock,
};

/**
 * How a verdict is drawn (design-spec §1, mockup 5.13):
 *   admit     green fill + check: let them in (a confirmed check-in only)
 *   already   amber heavy outline + repeat icon, with the time
 *   reject    red heavy outline + X: wrong event, no match, not an FFSA QR, cancelled
 *   queued    dashed outline + clock: saved on this phone, NOT confirmed (never green)
 *   attention ink heavy outline + alert: needs attention, undo failed, check-in undone
 */
export type VerdictLook = "admit" | "already" | "reject" | "queued" | "attention";

export function verdictLook(verdict: Pick<Verdict, "kind">): VerdictLook {
  switch (verdict.kind) {
    case "checked_in":
      return "admit";
    case "already":
      return "already";
    case "queued":
      return "queued";
    case "needs_attention":
      return "attention";
    case "wrong_event":
    case "invalid":
    case "void":
    case "not_a_ticket":
      return "reject";
  }
}

const OUTLINE = 4;

type LookStyle = { bg: string; fg: string; icon: string; border: string | null; dashed?: boolean };

export function verdictLookStyle(look: VerdictLook, c: SemanticColors): LookStyle {
  switch (look) {
    case "admit":
      return { bg: c.positive, fg: c.onPositive, icon: c.onPositive, border: null };
    case "already":
      return { bg: c.raised, fg: c.text, icon: c.attention, border: c.attention };
    case "reject":
      return { bg: c.raised, fg: c.text, icon: c.danger, border: c.danger };
    case "queued":
      return { bg: c.bg, fg: c.text, icon: c.text, border: c.text, dashed: true };
    case "attention":
      return { bg: c.raised, fg: c.text, icon: c.text, border: c.text };
  }
}

type Props = {
  verdict: Verdict;
  undoOpen: boolean;
  onUndo: () => void;
  onDismiss: () => void;
  /** Label for the dismiss button ("Scan next" over the camera). */
  dismissLabel?: string;
};

/**
 * The big answer after a scan. Each look has its own colour, border, icon
 * and words, so nobody needs to tell colours apart. Announced to screen
 * readers as it appears.
 */
export function VerdictCard({ verdict, undoOpen, onUndo, onDismiss, dismissLabel = strings.result.dismiss }: Props) {
  const { colors } = useTheme();
  const Icon = ICONS[verdict.icon];
  const look = verdictLook(verdict);
  const s = verdictLookStyle(look, colors);

  return (
    <View
      testID="verdict"
      accessibilityLiveRegion="assertive"
      style={{
        backgroundColor: s.bg,
        borderColor: s.border ?? s.bg,
        borderWidth: s.border ? OUTLINE : 0,
        borderStyle: s.dashed ? "dashed" : "solid",
        borderRadius: radius.card,
        // The filled card has no border: pad it so every look is the same size.
        padding: s.border ? space.lg : space.lg + OUTLINE,
        gap: space.md,
      }}
    >
      <View accessible accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View testID={`verdict-icon-${verdict.icon}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon size={40} color={s.icon} strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="sectionTitle" testID="verdict-title" style={{ fontSize: fontSize.sheetTitle, lineHeight: 24, color: s.fg }}>
            {verdict.title}
          </Text>
          {verdict.detail ? (
            <Text variant="caption" testID="verdict-detail" style={{ color: s.fg }}>
              {verdict.detail}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: space.md, flexWrap: "wrap" }}>
        {verdict.undoTicketId && undoOpen ? (
          <CardButton label={strings.result.undo} hint={strings.result.undoHint} onPress={onUndo} fg={s.fg} />
        ) : null}
        <CardButton label={dismissLabel} onPress={onDismiss} fg={s.fg} grow />
      </View>
    </View>
  );
}

/** Outline button in the card's own text colour, so it reads on green and on the outlined cards. */
function CardButton({ label, hint, onPress, fg, grow = false }: { label: string; hint?: string; onPress: () => void; fg: string; grow?: boolean }) {
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
        borderWidth: 2,
        borderColor: fg,
        borderRadius: radius.control,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: fontFamily.bodyBold, fontSize: fontSize.sectionTitle, lineHeight: 22, color: fg }}>{label}</Text>
    </Pressable>
  );
}
