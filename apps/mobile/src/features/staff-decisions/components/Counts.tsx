import { View } from "react-native";

import { Text } from "@/components";

import { strings } from "../strings";

const s = strings.list;

/**
 * Students / Yes / No / Undecided as a strip of mono labels over tabular
 * numerals (the web table's four columns). Hidden from screen readers: the
 * row around it speaks the same numbers as one sentence.
 */
export function Counts({ total, yes, no, undecided }: { total: number; yes: number; no: number; undecided: number }) {
  const cells: [string, number][] = [
    [s.students, total],
    [s.yes, yes],
    [s.no, no],
    [s.undecided, undecided],
  ];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}
    >
      {cells.map(([label, value]) => (
        <View key={label} style={{ gap: 2, minWidth: 64 }}>
          <Text variant="label" tone="secondary">
            {label}
          </Text>
          <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
            {String(value)}
          </Text>
        </View>
      ))}
    </View>
  );
}
