import * as Haptics from "expo-haptics";

/** Selection tick (segmented controls, day strips). Never throws: haptics are a nicety. */
export function selectionHaptic() {
  try {
    void Haptics.selectionAsync().catch(() => {});
  } catch {
    // No haptics engine (simulator, tests): nothing to do.
  }
}
