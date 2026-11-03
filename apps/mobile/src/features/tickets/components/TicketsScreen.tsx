import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useTheme } from "@/theme/use-theme";

type Props = {
  children: ReactNode;
  /** Pull-to-refresh. Omit for screens with nothing to refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: ViewStyle;
};

/**
 * The kit's <Screen> plus pull-to-refresh, which the shared Screen doesn't
 * offer yet (kept local so this slice doesn't edit the shared kit; worth
 * folding into Screen later). Same padding, background and safe areas.
 */
export function TicketsScreen({ children, onRefresh, refreshing = false, scroll = true, edges = ["bottom"], contentStyle }: Props) {
  const { colors } = useTheme();
  const padding: ViewStyle = { paddingHorizontal: 20, paddingVertical: 16, gap: 16 };
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[padding, { flexGrow: 1 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} colors={[colors.text]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[padding, { flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
