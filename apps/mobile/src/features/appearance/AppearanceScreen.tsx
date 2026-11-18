import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Banner, Screen, Text } from "@/components";
import { SkeletonRows } from "@/features/shell";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { useAppearance } from "./AppearanceProvider";
import { APPEARANCE_PREFERENCES, type AppearancePreference } from "./preference";
import { appearanceStrings as s } from "./strings";

/**
 * Me > Appearance: three radio choices. The look changes the moment one is
 * tapped (app-wide, status bar and native UI included) and is saved on this
 * phone only.
 */
export function AppearanceScreen() {
  const { ready, preference, setPreference } = useAppearance();
  const { scheme } = useTheme();
  const [saveFailed, setSaveFailed] = useState(false);

  async function choose(pref: AppearancePreference) {
    if (pref === preference) return;
    Haptics.selectionAsync().catch(() => {});
    setSaveFailed(!(await setPreference(pref)));
  }

  return (
    <Screen edges={["bottom"]}>
      <Text tone="secondary">{s.intro}</Text>

      {saveFailed ? (
        <Banner tone="danger" title={s.saveFailed.title} testID="appearance-save-failed">
          {s.saveFailed.body}
        </Banner>
      ) : null}

      {!ready ? (
        <SkeletonRows count={3} label={s.title} />
      ) : (
        <View accessibilityRole="radiogroup" accessibilityLabel={s.groupLabel} testID="appearance-options">
          {APPEARANCE_PREFERENCES.map((pref) => (
            <Choice
              key={pref}
              label={s.options[pref].label}
              body={s.options[pref].body(scheme)}
              checked={pref === preference}
              onPress={() => void choose(pref)}
              testID={`appearance-${pref}`}
            />
          ))}
        </View>
      )}

      <Text variant="caption" tone="secondary">
        {s.deviceOnly}
      </Text>
    </Screen>
  );
}

function Choice({
  label,
  body,
  checked,
  onPress,
  testID,
}: {
  label: string;
  body: string;
  checked: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={body}
      accessibilityState={{ checked, selected: checked }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.minTarget + 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 12,
        paddingHorizontal: 4,
        borderBottomWidth: hairline,
        borderBottomColor: colors.rule,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      {/* Square radio mark (the brand has no round corners). The words and
          the radio role carry the state too, never the mark alone. */}
      <View
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={{
          width: 22,
          height: 22,
          borderWidth: 2,
          borderColor: checked ? colors.text : colors.ruleStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <View testID={`${testID}-mark`} style={{ width: 10, height: 10, backgroundColor: colors.text }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" tone="secondary">
          {body}
        </Text>
      </View>
      {checked ? (
        <Text variant="monoLabel" tone="secondary">
          {s.selectedHint}
        </Text>
      ) : null}
    </Pressable>
  );
}
