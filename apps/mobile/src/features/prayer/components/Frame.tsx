import type { ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Masthead } from "@/components";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

/**
 * The Prayer Room page: safe area, one masthead (the web's yellow tick +
 * context line + PRAYER ROOM), the section strip, then the section's content,
 * with pull-to-refresh. Each section renders its own Frame so the refresh
 * gesture reloads what's on screen.
 */
export function Frame({
  context,
  nav,
  children,
  onRefresh,
  refreshing = false,
}: {
  context: string;
  nav: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        testID="prayer-scroll"
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} colors={[colors.text]} />
          ) : undefined
        }
      >
        <Masthead context={context} title={strings.title} />
        {nav}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
