import { Camera, Lock } from "lucide-react-native";
import { View } from "react-native";

import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Button } from "./Button";
import { kitStrings } from "./strings";
import { Text } from "./Text";

export type PhotoSlotProps = {
  /** Whether a photo is on file. Never show a decorative preview of an ID. */
  hasPhoto: boolean;
  /** Caption inside the empty slot (default "No photo yet"). */
  emptyLabel?: string;
  /** Caption on the locked tile (default "Photo on file"). */
  onFileLabel?: string;
  onView?: () => void;
  onTake?: () => void;
  onChoose?: () => void;
  onRemove?: () => void;
  /** Override action labels (defaults: View / Take a photo / Choose a photo / Remove). */
  labels?: Partial<Record<"view" | "take" | "choose" | "remove", string>>;
  /** Disables the actions while something is saving. */
  busy?: boolean;
  testID?: string;
};

/**
 * Dashed slot when empty; a locked "Photo on file" tile when present. Actions
 * underneath: View, Take a photo, Choose a photo, Remove (only those with a
 * handler are shown).
 */
export function PhotoSlot({
  hasPhoto,
  emptyLabel = kitStrings.photo.empty,
  onFileLabel = kitStrings.photo.onFile,
  onView,
  onTake,
  onChoose,
  onRemove,
  labels = {},
  busy = false,
  testID,
}: PhotoSlotProps) {
  const { colors } = useTheme();
  const Icon = hasPhoto ? Lock : Camera;
  const actions = [
    hasPhoto && onView ? { key: "view", label: labels.view ?? kitStrings.photo.view, onPress: onView, variant: "secondary" as const } : null,
    onTake ? { key: "take", label: labels.take ?? kitStrings.photo.take, onPress: onTake, variant: "secondary" as const } : null,
    onChoose ? { key: "choose", label: labels.choose ?? kitStrings.photo.choose, onPress: onChoose, variant: "secondary" as const } : null,
    hasPhoto && onRemove ? { key: "remove", label: labels.remove ?? kitStrings.photo.remove, onPress: onRemove, variant: "danger" as const } : null,
  ].filter((a) => a !== null);

  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={hasPhoto ? onFileLabel : emptyLabel}
        style={{
          minHeight: 140,
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: space.lg,
          borderRadius: radius.card,
          borderWidth: hairline,
          borderStyle: hasPhoto ? "solid" : "dashed",
          borderColor: hasPhoto ? colors.rule : colors.ruleStrong,
          backgroundColor: colors.surface,
        }}
      >
        <Icon size={24} color={colors.textSecondary} />
        <Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
          {hasPhoto ? onFileLabel : emptyLabel}
        </Text>
      </View>
      {actions.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {actions.map((a) => (
            <Button
              key={a.key}
              label={a.label}
              variant={a.variant}
              size="small"
              disabled={busy}
              onPress={a.onPress}
              style={{ flexGrow: 1, flexBasis: "40%" }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
