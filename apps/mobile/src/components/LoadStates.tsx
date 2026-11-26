import { TriangleAlert } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { useAnnounceOnIOS } from "@/lib/a11y";
import { formatSavedAt } from "@/lib/saved-at";
import { space } from "@/theme/tokens";

import { Banner } from "./Banner";
import { EmptyState } from "./EmptyState";
import { Bleed } from "./PushedPage";
import { kitStrings } from "./strings";
import { Text } from "./Text";

// The load states every list screen shares (design-spec §6): an error that
// says what to do with Try again, and the calm note when what's on screen is
// the copy saved on this phone.

/** Couldn't load (nothing saved to show): what happened, what to do, Try again. Announced. */
export function LoadError({ title, message, onRetry, testID }: { title: string; message: string; onRetry: () => void; testID?: string }) {
  return (
    <Banner tone="error" title={title} actionLabel={kitStrings.tryAgain} onAction={onRetry} testID={testID}>
      {message}
    </Banner>
  );
}

/** The same, as a calm card in place of the list (frame 13.2). Announced on iOS; a live region on Android. */
export function LoadFailed({ title, message, onRetry, testID = "load-failed" }: { title: string; message: string; onRetry: () => void; testID?: string }) {
  useAnnounceOnIOS(message);
  return (
    <View accessibilityLiveRegion="polite" testID={testID}>
      <EmptyState icon={TriangleAlert} title={title} body={message} actionLabel={kitStrings.tryAgain} onAction={onRetry} />
    </View>
  );
}

/** The saved copy is showing because a refresh failed or the phone is offline. */
export function StaleNote({ message, onRetry, testID }: { message: string; onRetry: () => void; testID?: string }) {
  return (
    <Banner tone="offline" actionLabel={kitStrings.tryAgain} onAction={onRetry} testID={testID}>
      {message}
    </Banner>
  );
}

/** Anything with the shape of useCachedLoad's state. */
export type FreshnessState = { status: string; staleSince?: number | null; refreshError?: string | null };

/**
 * When what's on screen is the copy saved on this phone: a quiet
 * "Last updated 09:05" line, or the offline note with Try again when a
 * refresh failed ("Couldn't refresh. Showing what was saved at 09:05.").
 * `children` sit under the note (e.g. "Check-ins need a signal.").
 */
export function Freshness({
  state,
  onRetry,
  bleed = false,
  children,
}: {
  state: FreshnessState;
  onRetry: () => void;
  /** Pull the note out to the 16pt card edge (inside a gutter-padded page). */
  bleed?: boolean;
  children?: ReactNode;
}) {
  if (state.status !== "ready" || !state.staleSince) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) {
    const note = <StaleNote message={kitStrings.refreshFailed(when)} onRetry={onRetry} />;
    return (
      <View style={{ gap: space.sm }}>
        {bleed ? <Bleed>{note}</Bleed> : note}
        {children}
      </View>
    );
  }
  return (
    <Text variant="caption" tone="secondary" testID="last-updated">
      {kitStrings.lastUpdated(when)}
    </Text>
  );
}
