import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";

import { Banner, SwitchRow } from "@/components";
import { space } from "@/theme/tokens";

import { useLock, type EnableResult } from "./LockProvider";
import { lockStrings as s } from "./strings";

/**
 * Me › Settings: "Lock with Face ID" (Touch ID / Fingerprint / Face unlock,
 * whatever the phone reports). Shown only when the phone has the hardware
 * and something enrolled, or when the lock is already on (so it can always
 * be switched off). Turning it on asks for Face ID once; a cancel or a
 * failure leaves it off.
 */
export function LockSettingRow() {
  const { enabled, biometrics, setEnabled } = useLock();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Extract<EnableResult, "failed" | "saveFailed"> | null>(null);

  if (biometrics.status !== "available" && !enabled) return null;
  const kind = biometrics.status === "available" ? biometrics.kind : "faceId";

  async function change(next: boolean) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await setEnabled(next);
    setBusy(false);
    if (result === "failed" || result === "saveFailed") {
      setProblem(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else if (result === "on") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }

  const message = problem === "failed" ? s.setting.failed : problem === "saveFailed" ? s.setting.saveFailed : null;

  return (
    <View testID="lock-setting">
      <SwitchRow
        testID="lock-switch"
        label={s.setting.label(kind)}
        description={s.setting.description(kind)}
        value={enabled}
        onChange={(next) => void change(next)}
        stateWords={{ on: s.setting.on, off: s.setting.off }}
        disabled={busy}
        busy={busy}
      />
      {message ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
          <Banner tone="error" title={message.title} testID={`lock-setting-${problem}`}>
            {message.body}
          </Banner>
        </View>
      ) : null}
    </View>
  );
}
