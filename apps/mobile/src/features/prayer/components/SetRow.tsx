import { MapPin } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { Band, PrayerSet, SeatType } from "../api";
import {
  bandFor,
  durationLabel,
  leadNames,
  myRelation,
  needsALead,
  seatCounts,
  setSentence,
  setTitle,
  timeRange,
  toMin,
} from "../logic";
import { strings } from "../strings";

import { Chip } from "./ui";

/**
 * One set in the week's vertical run (frame 11b). The wall's vocabulary in
 * words as well as looks: bone = a set; dashed border + "NEEDS A LEAD" = not
 * live yet; the black band chip = a curated MORNING / NOON / NIGHT set; a
 * heavy ink border + "YOU" = you're on it. Read aloud as one sentence.
 */
export function SetRow({
  set,
  seatTypes,
  bands,
  userId,
  onPress,
}: {
  set: PrayerSet;
  seatTypes: SeatType[];
  bands: Band[];
  userId: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const rel = myRelation(set, userId);
  const unled = needsALead(set, seatTypes);
  const band = bandFor(set, bands);
  const lead = leadNames(set, seatTypes);
  const c = seatCounts(set);
  const mine = rel === "serving" || rel === "owner";

  return (
    <Pressable
      testID={`set-${set.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${setSentence(set, seatTypes, bands, userId)}. ${strings.a11y.setRowExtra(
        strings.a11y.duration(Math.max(0, toMin(set.end_time) - toMin(set.start_time))),
        lead,
      )}`}
      accessibilityHint={strings.set.openHint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.minTarget + 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 4,
        backgroundColor: pressed ? colors.surfaceStrong : colors.surface,
        borderWidth: mine ? 2 : hairline,
        borderStyle: unled ? "dashed" : "solid",
        borderColor: mine || unled ? colors.text : colors.rule,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
          {timeRange(set.start_time, set.end_time)}
        </Text>
        <Text variant="monoLabel" tone="secondary">
          {durationLabel(set.start_time, set.end_time)}
        </Text>
        <View style={{ flex: 1 }} />
        {rel === "serving" ? <Chip label={strings.set.you} tone="ink" /> : null}
        {rel === "invited" ? <Chip label={strings.set.invited} tone="ink" /> : null}
        {rel === "owner" ? <Chip label={strings.set.yourSet} /> : null}
        {band ? <Chip label={band} tone="band" /> : null}
      </View>
      <Text variant="title" numberOfLines={2}>
        {setTitle(set)}
      </Text>
      <Text tone="secondary">
        {lead ? strings.set.ledBy(lead) : strings.set.noLead} · {strings.set.seatsTaken(c.taken, c.total)}
      </Text>
      {set.relocation_note ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <MapPin size={14} color={colors.textSecondary} />
          </View>
          <Text variant="caption" tone="secondary">
            {strings.set.relocated(set.relocation_note)}
          </Text>
        </View>
      ) : null}
      {unled ? (
        <View style={{ flexDirection: "row" }}>
          <Chip label={strings.set.needsLead} />
        </View>
      ) : null}
    </Pressable>
  );
}
