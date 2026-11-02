import { useColorScheme } from "react-native";

import { colors, type ColorScheme, type SemanticColors } from "./tokens";

export type Theme = { scheme: ColorScheme; colors: SemanticColors };

export function themeFor(scheme: string | null | undefined): Theme {
  const s: ColorScheme = scheme === "dark" ? "dark" : "light";
  return { scheme: s, colors: colors[s] };
}

/** Follows the system light/dark setting. */
export function useTheme(): Theme {
  return themeFor(useColorScheme());
}
