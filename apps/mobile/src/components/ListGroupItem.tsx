import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

import { hairline, radius } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export type ListGroupItemProps = {
  /** This row's place in the group (0-based). */
  index: number;
  /** How many rows the group has. */
  count: number;
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
};

/**
 * One row of a ListGroup drawn on its own, for rows a FlatList / SectionList
 * renders (virtualised lists, hundreds of rows). Together the rows look
 * exactly like ListGroup: 1px rule border, 8pt corners on the first and last
 * row, raised fill, a hairline between rows. Put each one in a Bleed (or
 * give the list 16pt side padding) to sit on the card edge.
 */
export function ListGroupItem({ index, count, children, style, testID }: ListGroupItemProps) {
  const { colors } = useTheme();
  const first = index === 0;
  const last = index === count - 1;
  return (
    <View
      testID={testID}
      style={[
        {
          borderColor: colors.rule,
          borderLeftWidth: hairline,
          borderRightWidth: hairline,
          borderTopWidth: first ? hairline : 0,
          borderBottomWidth: last ? hairline : 0,
          borderTopLeftRadius: first ? radius.card : 0,
          borderTopRightRadius: first ? radius.card : 0,
          borderBottomLeftRadius: last ? radius.card : 0,
          borderBottomRightRadius: last ? radius.card : 0,
          backgroundColor: colors.raised,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {!first ? (
        <View
          testID="list-group-item-rule"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: hairline, backgroundColor: colors.rule }}
        />
      ) : null}
      {children}
    </View>
  );
}
