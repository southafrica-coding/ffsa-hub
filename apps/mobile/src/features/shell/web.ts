// Pages the app doesn't have yet open in the in-app browser (SFSafariViewController
// / Chrome Custom Tabs), so people stay in the app and come back with one tap.
// Note: that browser doesn't share the app's sign-in, so the website may ask
// them to sign in once.

import * as WebBrowser from "expo-web-browser";

import { getEnv } from "@/lib/env";
import type { SemanticColors } from "@/theme/tokens";

/** Absolute website URL for a site path like "/profile". Full URLs pass through. */
export function webUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${getEnv().apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function openWebPage(pathOrUrl: string, colors?: SemanticColors) {
  try {
    await WebBrowser.openBrowserAsync(webUrl(pathOrUrl), {
      controlsColor: colors?.text,
      toolbarColor: colors?.bg,
      enableBarCollapsing: true,
    });
  } catch {
    // Opening a browser can fail if one is already open; nothing to recover.
  }
}
