import { Mail, MapPin } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { StatusChip, Text } from "@/components";
import { fontFamily, hairline, radius, space } from "@/theme/tokens";
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
  toMin,
} from "../logic";
import { strings } from "../strings";

import { BandChip } from "./ui";

/**
 * One set in the day's run (frame 4.1): the start and end in a mono time
 * column, then a card. The wall's vocabulary in words as well as looks: a
 * dashed card + "Needs a lead" = not live yet; the band chip = a curated
 * MORNING / NOON / NIGHT set; a 2pt ink border + "You" (or "Your set") =
 * yours. Read aloud as one sentence.
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
  const time = { fontFamily: fontFamily.mono, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums" as const] };

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
      style={{ minHeight: 64, flexDirection: "row", alignItems: "stretch", gap: space.md }}
    >
      {({ pressed }) => (
        <>
          <View style={{ minWidth: 48, paddingTop: 10 }}>
            <Text style={time}>{set.start_time.slice(0, 5)}</Text>
            <Text tone="secondary" style={time}>
              {set.end_time.slice(0, 5)}
            </Text>
          </View>
          <View
            style={{
              flex: 1,
              minWidth: 0,
              paddingHorizontal: space.md,
              paddingVertical: 10,
              gap: 2,
              borderRadius: radius.card,
              backgroundColor: pressed ? colors.surfaceStrong : unled && !mine ? "transparent" : colors.surface,
              borderWidth: mine ? 2 : unled ? 1.5 : hairline,
              borderStyle: unled && !mine ? "dashed" : "solid",
              borderColor: mine ? colors.text : unled ? colors.ruleStrong : colors.rule,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text variant="caption" tone="secondary" style={{ fontFamily: fontFamily.mono }}>
                {durationLabel(set.start_time, set.end_time)}
              </Text>
              <View style={{ flex: 1 }} />
              {rel === "serving" ? <StatusChip label={strings.set.you} variant="ink" icon={null} /> : null}
              {rel === "invited" ? <StatusChip label={strings.set.invited} variant="ink" icon={Mail} /> : null}
              {rel === "owner" ? <StatusChip label={strings.set.yourSet} icon={null} /> : null}
              {band ? <BandChip label={band} /> : null}
            </View>
            <Text variant="rowTitle">{setTitle(set)}</Text>
            <Text variant="caption" tone="secondary">
              {lead ? strings.set.ledBy(lead) : strings.set.noLead} · {strings.set.seatsTaken(c.taken, c.total)}
            </Text>
            {set.relocation_note ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <MapPin size={14} color={colors.textSecondary} />
                </View>
                <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                  {strings.set.relocated(set.relocation_note)}
                </Text>
              </View>
            ) : null}
            {unled ? (
              <View style={{ marginTop: space.xs }}>
                <StatusChip label={strings.set.needsLead} variant="dashed" />
              </View>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  );
}
