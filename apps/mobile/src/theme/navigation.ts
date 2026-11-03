// React Navigation theme built from the tokens, so every navigator's default
// scene, card and header background follows the app's colour scheme (no
// white flash behind a screen while it mounts in dark mode).

import { DarkTheme, DefaultTheme } from "expo-router";

import type { Theme } from "./use-theme";

export type NavigationTheme = typeof DefaultTheme;

export function navigationTheme({ scheme, colors }: Theme): NavigationTheme {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === "dark",
    colors: {
      ...base.colors,
      primary: colors.text,
      background: colors.bg,
      card: colors.bg,
      text: colors.text,
      border: colors.rule,
      notification: colors.inverse,
    },
  };
}
