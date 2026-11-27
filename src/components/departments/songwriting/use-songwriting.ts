"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReadOrResult } from "@/components/song-library/client";
import { songwritingApi } from "./api";
import { EMPTY_SONGWRITING, type SongwritingData, type SongwritingLead } from "./types";

export type SongwritingState = {
  loading: boolean;
  data: SongwritingData;
  denied: boolean;
  reload: () => void;
  /** Apply a lead from a write reply (log / delete contact, edit) without a full reload. */
  patchLead: (lead: SongwritingLead) => void;
};

// The band in the header and the page's view both read GET /songwriting.
// They mount together, so one request in flight per slug is shared.
const inflight = new Map<string, Promise<ReadOrResult<SongwritingData>>>();

function loadShared(slug: string): Promise<ReadOrResult<SongwritingData>> {
  let pending = inflight.get(slug);
  if (!pending) {
    pending = songwritingApi(slug)
      .load()
      .finally(() => inflight.delete(slug));
    inflight.set(slug, pending);
  }
  return pending;
}

/** Loads the Songwriting payload (with viewer). A 403 is denied, not empty. */
export function useSongwriting(slug: string, initial?: SongwritingData): SongwritingState {
  const [state, setState] = useState<Omit<SongwritingState, "reload" | "patchLead">>({
    loading: !initial,
    data: initial ?? EMPTY_SONGWRITING,
    denied: false,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const patchLead = useCallback((lead: SongwritingLead) => {
    setState((s) => ({
      ...s,
      data: { ...s.data, leads: s.data.leads.map((row) => (row.id === lead.id ? lead : row)) },
    }));
  }, []);
  useEffect(() => {
    if (initial && tick === 0) return;
    let cancelled = false;
    loadShared(slug).then((result) => {
      if (!cancelled) setState({ loading: false, data: result.data, denied: result.denied });
    });
    return () => {
      cancelled = true;
    };
  }, [slug, initial, tick]);
  return { ...state, reload, patchLead };
}
