import { ArrowUpRight } from "lucide-react-native";
import { View } from "react-native";

import { Button, Sheet, Text } from "@/components";
import { hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { HistoryRecord } from "../logic";
import { strings } from "../strings";

const s = strings.detail;

/**
 * One record in full (frames 9.2, 9.3): what the web keeps behind its
 * disclosure. The raw import payload can be twenty fields wide, so it lives
 * here rather than on the list row. A document's file opens in the in-app
 * browser; nothing is downloaded into the app.
 */
export function RecordSheet({
  record,
  onClose,
  onOpenFile,
}: {
  record: HistoryRecord | null;
  onClose: () => void;
  onOpenFile: (url: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={record !== null} title={record?.title ?? ""} onClose={onClose} closeLabel={s.close}>
      {record ? (
        <View style={{ gap: space.lg }} testID="record-sheet">
          {record.subtitle || record.date ? (
            <View style={{ gap: space.xs }}>
              {record.subtitle ? <Text tone="secondary">{record.subtitle}</Text> : null}
              {record.date ? (
                <Text variant="rowTitle" style={{ fontVariant: ["tabular-nums"] }}>
                  {`${record.dateLabel} ${record.date}`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {record.fileUrl ? (
            <Button
              label={s.openFile}
              variant="secondary"
              icon={<ArrowUpRight size={20} color={colors.text} />}
              accessibilityHint={s.openFileHint}
              onPress={() => onOpenFile(record.fileUrl!)}
              testID="open-file"
            />
          ) : null}

          {record.details.length > 0 ? (
            <View>
              <Text variant="label" accessibilityRole="header" style={{ marginBottom: space.xs }}>
                {s.more}
              </Text>
              {record.details.map((d, i) => (
                <View
                  // Keys in an import payload are unique, but be safe about order.
                  key={`${i}-${d.label}`}
                  accessible
                  accessibilityLabel={`${d.label}: ${d.value === s.empty ? "blank" : d.value}`}
                  style={{ paddingVertical: space.sm, gap: 2, borderBottomWidth: hairline, borderBottomColor: colors.rule }}
                >
                  <Text variant="caption" tone="secondary">
                    {d.label}
                  </Text>
                  <Text selectable>{d.value}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text tone="secondary">{s.nothingMore}</Text>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}
