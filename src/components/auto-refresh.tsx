"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 10_000; // 10 seconds
// If a refresh never reports back (e.g. a navigation discarded it), stop
// waiting on it after this long.
const STALE_REFRESH_MS = 60_000;
// Timers drift, so "a full interval since the last refresh" allows a second's slack.
const MIN_GAP_MS = REFRESH_INTERVAL_MS - 1_000;

/**
 * Silently re-fetches all server component data on a timer.
 * Drop this anywhere in a layout to keep data fresh across all connected clients.
 *
 * A refresh re-renders the whole layout + page on the server, so it only runs
 * when someone can see the result, and never piles up:
 *   - one at a time: a tick is skipped while the previous refresh is still in
 *     flight. Before, a page slower than the interval queued another full
 *     server re-render every 10s behind the last, without bound.
 *   - not in a background tab: nobody is looking, so it was pure server load.
 *     Coming back to the tab refreshes straight away.
 *   - not right after a navigation: the page that just arrived is fresh.
 */
export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // The interval reads these through refs so it never needs re-creating.
  const inFlightSinceRef = useRef<number | null>(null);
  const lastActivityRef = useRef(0);

  // The transition settling means the refresh has landed.
  useEffect(() => {
    if (!isPending) inFlightSinceRef.current = null;
  }, [isPending]);

  // A navigation discards a pending refresh and brings fresh data anyway.
  useEffect(() => {
    inFlightSinceRef.current = null;
    lastActivityRef.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    function refresh() {
      // Never refresh while a blocking gate (profile / family / consent) is on
      // screen — a background refresh re-runs the gate and can auto-advance the
      // user mid-flow (e.g. jump to consent while they're adding another child).
      if (document.querySelector("[data-blocking-gate]")) return;
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const inFlightSince = inFlightSinceRef.current;
      if (inFlightSince !== null && now - inFlightSince < STALE_REFRESH_MS) return;
      if (now - lastActivityRef.current < MIN_GAP_MS) return;
      inFlightSinceRef.current = now;
      lastActivityRef.current = now;
      startTransition(() => router.refresh());
    }

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") {
        // Catch up immediately on return rather than waiting for the next tick.
        lastActivityRef.current = 0;
        refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
