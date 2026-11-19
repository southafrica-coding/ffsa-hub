import { useEffect } from "react";
import { Platform } from "react-native";

import { announce } from "./announce";

/**
 * Speaks a message on iOS each time it changes to something new. Android
 * reads accessibilityLiveRegion instead (iOS ignores live regions), so pair
 * this with a live region on the visible text to cover both, once each.
 */
export function useAnnounceOnIOS(message: string | null | undefined) {
  useEffect(() => {
    if (message && Platform.OS === "ios") announce(message);
  }, [message]);
}
