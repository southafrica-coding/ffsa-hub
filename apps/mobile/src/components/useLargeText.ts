import { useWindowDimensions } from "react-native";

// Large text: above iOS's biggest standard size (xxxLarge is 1.35), i.e. the
// accessibility sizes. Rows that put two things side by side stack them from
// here, so neither is squeezed until a word breaks in half (QA, Nov 2026).
// Same threshold as Finance's expense form (sideBySide).
export const LARGE_TEXT_SCALE = 1.3;

export function isLargeText(fontScale: number): boolean {
  return fontScale > LARGE_TEXT_SCALE;
}

/** True when the person's text size is too big for side-by-side rows. */
export function useLargeText(): boolean {
  return isLargeText(useWindowDimensions().fontScale);
}
