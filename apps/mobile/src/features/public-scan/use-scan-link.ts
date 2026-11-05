// Is this scan link live, and which event is it for? Asked once when the
// link is opened (and again on Try again). The tally answers "live or not":
// it is the same request the door itself makes. The event title is a nicety
// (it comes from a newer endpoint), so a failure there never blocks the door.

import { useCallback, useEffect, useRef, useState } from "react";

import { doorStatsSchema } from "@/features/tickets/api";
import { ApiError } from "@/lib/api";

import { getScanEvent, isDeadLinkError, scanApiPath, type PublicFetch, type ScanEvent } from "./api";
import { strings } from "./strings";

export type ScanLinkState =
  | { status: "loading" }
  /** bad_link: not shaped like a link at all; gone: the server doesn't know it (any more). */
  | { status: "dead"; reason: "bad_link" | "gone" }
  | { status: "error"; message: string }
  | { status: "ready"; event: ScanEvent | null };

/** Plain words for a failed first load, with the next step. */
export function linkErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "network" || err.kind === "timeout") return strings.offlineBody;
    if (err.status === 429) return strings.busyBody;
    return err.message;
  }
  return "Something went wrong. Try again.";
}

export function useScanLink(token: string | null, publicFetch: PublicFetch) {
  const [state, setState] = useState<ScanLinkState>(token ? { status: "loading" } : { status: "dead", reason: "bad_link" });
  // Only the latest ask may answer (Try again while a slow first try is out).
  const latest = useRef(0);

  const ask = useCallback(async () => {
    if (!token) return;
    const mine = ++latest.current;
    const [stats, event] = await Promise.allSettled([
      publicFetch(`${scanApiPath(token)}?stats=1`, { schema: doorStatsSchema }),
      getScanEvent(publicFetch, token),
    ]);
    if (mine !== latest.current) return;
    if (stats.status === "rejected") {
      setState(
        isDeadLinkError(stats.reason)
          ? { status: "dead", reason: "gone" }
          : { status: "error", message: linkErrorMessage(stats.reason) },
      );
      return;
    }
    setState({ status: "ready", event: event.status === "fulfilled" ? event.value : null });
  }, [token, publicFetch]);

  useEffect(() => {
    (async () => {
      await ask();
    })();
    // Leaving the screen: let no answer land afterwards.
    return () => {
      latest.current += 1;
    };
  }, [ask]);

  const retry = useCallback(async () => {
    if (!token) return;
    setState({ status: "loading" });
    await ask();
  }, [token, ask]);

  return { ...state, retry };
}
