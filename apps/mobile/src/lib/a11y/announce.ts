import { AccessibilityInfo, Platform } from "react-native";

/**
 * Speak a short message through VoiceOver / TalkBack, e.g. "Receipt saved"
 * or a scan verdict. Does nothing when no screen reader is listening (the
 * native call is a no-op then) or when the message is empty.
 *
 * On iOS the message is queued behind whatever VoiceOver is already saying
 * (a focus change after navigation would otherwise cut it off).
 */
export function announce(message: string | null | undefined): void {
  const text = message?.trim();
  if (!text) return;
  if (Platform.OS === "ios" && typeof AccessibilityInfo.announceForAccessibilityWithOptions === "function") {
    AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
    return;
  }
  AccessibilityInfo.announceForAccessibility(text);
}

/** Joins the parts that exist into one sentence-per-part announcement. */
export function announcement(...parts: (string | null | undefined | false)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim().replace(/[.!?]$/, ""))
    .join(". ");
}
