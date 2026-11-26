import type { ReactNode } from "react";
import { RefreshControl } from "react-native";

import { LargeTitleScrollView, type LargeTitleProps, KeyboardAvoidingView } from "@/components";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = LargeTitleProps & {
  children: ReactNode;
  /** Pull-to-refresh. Omit for screens with nothing to refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Pad the home indicator: screens with no tab bar under them (ticket QR, the doors). */
  bottomInset?: boolean;
  /** Lift the content above the keyboard (the door's code and name fields). */
  keyboard?: boolean;
};

/**
 * Every Tickets page: the kit's collapsing LargeTitle header plus
 * pull-to-refresh (which the kit's scroll view takes as a prop).
 */
export function TicketsScreen({ children, onRefresh, refreshing = false, bottomInset = false, keyboard = false, ...header }: Props) {
  const { colors } = useTheme();
  const page = (
    <LargeTitleScrollView
      {...header}
      gap={space.md}
      edges={bottomInset ? ["top", "bottom"] : ["top"]}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} /> : undefined
      }
    >
      {children}
    </LargeTitleScrollView>
  );
  if (!keyboard) return page;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }}>
      {page}
    </KeyboardAvoidingView>
  );
}
