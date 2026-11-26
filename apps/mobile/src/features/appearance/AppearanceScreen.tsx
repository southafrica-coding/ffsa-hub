import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";

import { Banner, RadioRow, Text } from "@/components";
import { Group, GroupSkeleton, GROUP_BLEED } from "@/features/me/components/me-kit";
import { MePage } from "@/features/me/components/MePage";
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
    <MePage title={s.title}>
      <View style={{ gap: 16 }}>
        <Text tone="secondary">{s.intro}</Text>

        {saveFailed ? (
          <Banner tone="error" title={s.saveFailed.title} testID="appearance-save-failed">
            {s.saveFailed.body}
          </Banner>
        ) : null}

        {!ready ? (
          <GroupSkeleton count={3} label={s.title} />
        ) : (
          // The group role sits on a plain wrapper; the inset list inside draws the rows.
          <View accessibilityRole="radiogroup" accessibilityLabel={s.groupLabel} testID="appearance-options" style={{ marginHorizontal: GROUP_BLEED }}>
            <Group style={{ marginHorizontal: 0 }}>
              {APPEARANCE_PREFERENCES.map((pref) => (
                <RadioRow
                  key={pref}
                  label={s.options[pref].label}
                  body={s.options[pref].body(scheme)}
                  checked={pref === preference}
                  onPress={() => void choose(pref)}
                  testID={`appearance-${pref}`}
                />
              ))}
            </Group>
          </View>
        )}

        <Text variant="caption" tone="secondary">
          {s.deviceOnly}
        </Text>
      </View>
    </MePage>
  );
}
