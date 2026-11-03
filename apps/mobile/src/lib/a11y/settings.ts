import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

type Setting = "reduceMotionChanged" | "screenReaderChanged";

function useAccessibilitySetting(event: Setting, read: () => Promise<boolean>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    read()
      .then((v) => alive && setOn(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(event, (v: boolean) => setOn(v));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [event, read]);
  return on;
}

const readReduceMotion = () => AccessibilityInfo.isReduceMotionEnabled();
const readScreenReader = () => AccessibilityInfo.isScreenReaderEnabled();

/** True while the person has asked the phone for less motion. Starts false. */
export function useReduceMotion(): boolean {
  return useAccessibilitySetting("reduceMotionChanged", readReduceMotion);
}

/**
 * True while VoiceOver / TalkBack is on. Use it only to keep things on screen
 * longer (e.g. an undo button that would time out), never to hide content.
 */
export function useScreenReader(): boolean {
  return useAccessibilitySetting("screenReaderChanged", readScreenReader);
}
