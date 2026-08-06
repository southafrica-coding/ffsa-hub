"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 10_000; // 10 seconds

/**
 * Silently re-fetches all server component data on a timer.
 * Drop this anywhere in a layout to keep data fresh across all connected clients.
 */
export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      // Never refresh while a blocking gate (profile / family / consent) is on
      // screen — a background refresh re-runs the gate and can auto-advance the
      // user mid-flow (e.g. jump to consent while they're adding another child).
      if (document.querySelector("[data-blocking-gate]")) return;
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [router]);

  return null;
}
