// A date or time, picked with the platform's own picker: the system dialog
// on Android, a bottom sheet with the iOS wheel on iPhone. The field shows
// the value in words and is one 48dp button for screen readers.

import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { CalendarDays, Clock } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { Button, Text } from "@/components";
import { Sheet } from "@/features/finance/components/Sheet";
import { hairline, radius, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { dateFromISO, hmFromDate, humanDate, isoFromDate } from "../logic";
import { strings } from "../strings";

type Props = {
  mode: "date" | "time";
  label: string;
  /** YYYY-MM-DD (date) or HH:MM (time); "" when not set. */
  value: string;
  onChange: (v: string) => void;
  /** Show a Clear action (optional fields). */
  clearable?: boolean;
  minimumDate?: string;
  testID?: string;
};

function toDate(mode: "date" | "time", value: string, fallbackDate?: string): Date {
  if (mode === "date") return value ? dateFromISO(value) : fallbackDate ? dateFromISO(fallbackDate) : new Date();
  const d = new Date();
  const [h, m] = (value || "09:00").split(":").map((n) => parseInt(n, 10));
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function fromDate(mode: "date" | "time", d: Date): string {
  return mode === "date" ? isoFromDate(d) : hmFromDate(d);
}

export function DateTimeField({ mode, label, value, onChange, clearable = false, minimumDate, testID }: Props) {
  const { colors, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => toDate(mode, value, minimumDate));
  const shown = value ? (mode === "date" ? humanDate(value) : value) : strings.when.notSet;
  const Icon = mode === "date" ? CalendarDays : Clock;
  const min = mode === "date" && minimumDate ? dateFromISO(minimumDate) : undefined;

  function openPicker() {
    const start = toDate(mode, value, minimumDate);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: start,
        mode,
        is24Hour: true,
        minimumDate: min,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === "set" && d) onChange(fromDate(mode, d));
        },
      });
      return;
    }
    setDraft(start);
    setOpen(true);
  }

  return (
    <View style={{ gap: 6 }}>
      {/* The button below says the label and the value, so this isn't read twice. */}
      <Text variant="monoLabel" tone="secondary" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${shown}`}
          accessibilityHint={mode === "date" ? strings.when.pickDate(label) : strings.when.pickTime(label)}
          onPress={openPicker}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: touch.minTarget,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            borderWidth: hairline,
            borderColor: colors.ruleStrong,
            borderRadius: radius.control,
            backgroundColor: pressed ? colors.surface : colors.bg,
          })}
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon size={18} color={colors.textSecondary} />
          </View>
          <Text tone={value ? "default" : "secondary"} style={{ flexShrink: 1 }}>
            {shown}
          </Text>
        </Pressable>
        {clearable && value ? <Button label={strings.when.clear} variant="ghost" onPress={() => onChange("")} accessibilityLabel={`${strings.when.clear} ${label}`} /> : null}
      </View>
      {Platform.OS === "ios" ? (
        <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
          <View style={{ alignItems: "center", gap: 12 }}>
            <DateTimePicker
              value={draft}
              mode={mode}
              display={mode === "date" ? "inline" : "spinner"}
              minimumDate={min}
              themeVariant={scheme}
              accentColor={colors.text}
              onChange={(_e: DateTimePickerEvent, d?: Date) => {
                if (d) setDraft(d);
              }}
            />
            <Button
              label={strings.when.done}
              onPress={() => {
                onChange(fromDate(mode, draft));
                setOpen(false);
              }}
              style={{ alignSelf: "stretch" }}
            />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}
