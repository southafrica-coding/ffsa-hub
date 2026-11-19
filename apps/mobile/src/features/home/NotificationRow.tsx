import {
  Archive,
  Bell,
  CalendarClock,
  Car,
  Music,
  ShieldAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text, WebHint } from "@/components";
import { fontFamily, fontSize, hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { FeedItem } from "./api";
import type { Target } from "./feed-logic";
import { homeStrings } from "./strings";

// Same icon per kind as the web dashboard's feed.
const ICONS: Record<string, LucideIcon> = {
  booking: CalendarClock,
  user: UserPlus,
  records: Archive,
  vehicle: Car,
  insurance: ShieldAlert,
  practice: Music,
};

/**
 * One feed item: icon tile (filled ink when unread), title (bold when
 * unread), what it's about, then when and the "Opens in browser" cue. Read
 * state is in the weight and the VoiceOver label, never colour alone.
 */
export function NotificationRow({
  item,
  when,
  target,
  onPress,
}: {
  item: FeedItem;
  when: string | null;
  target: Target;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const Icon = ICONS[item.kind] ?? Bell;
  const web = target.kind === "web";
  const unread = !item.read;

  return (
    <Pressable
      testID={`notification-${item.key}`}
      accessibilityRole={web ? "link" : "button"}
      accessibilityLabel={homeStrings.itemA11y(item.title, item.body, item.read, when, web)}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.xs,
        borderBottomWidth: hairline,
        borderBottomColor: colors.rule,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.control,
          backgroundColor: unread ? colors.inverse : colors.surface,
        }}
      >
        <Icon size={18} color={unread ? colors.onInverse : colors.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant={unread ? "rowTitle" : "body"} tone={unread ? "default" : "secondary"}>
          {item.title}
        </Text>
        {item.body ? (
          <Text variant="caption" tone="secondary">
            {item.body}
          </Text>
        ) : null}
        {when || web ? (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: 2 }}>
            {when ? (
              <Text variant="caption" tone="secondary" style={{ fontSize: fontSize.eyebrow, lineHeight: 16, fontFamily: fontFamily.bodyMedium }}>
                {when}
              </Text>
            ) : null}
            {web ? <WebHint /> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
