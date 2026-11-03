import {
  Archive,
  Bell,
  CalendarClock,
  Car,
  ExternalLink,
  Music,
  ShieldAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { shellStrings } from "@/features/shell/strings";
import { hairline, touch } from "@/theme/tokens";
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
        minHeight: touch.minTarget + 16,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 4,
        borderBottomWidth: hairline,
        borderBottomColor: colors.rule,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      <View
        importantForAccessibility="no"
        style={{
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: unread ? colors.inverse : colors.surface,
        }}
      >
        <Icon size={18} color={unread ? colors.onInverse : colors.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant={unread ? "bodyStrong" : "body"} tone={unread ? "default" : "secondary"}>
          {item.title}
        </Text>
        {item.body ? (
          <Text variant="caption" tone="secondary" numberOfLines={3}>
            {item.body}
          </Text>
        ) : null}
        {when || web ? (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
            {when ? (
              <Text variant="label" tone="secondary">
                {when}
              </Text>
            ) : null}
            {web ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <ExternalLink size={12} color={colors.textSecondary} />
                <Text variant="label" tone="secondary">
                  {shellStrings.opensInBrowser}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
