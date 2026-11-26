"use client";

import { useEffect, useState } from "react";
import { songwritingApi } from "./api";
import { EMPTY_SONGWRITING, type SongwritingData } from "./types";

export type SongwritingState = { loading: boolean; data: SongwritingData };

/** Loads the Songwriting payload. Until the backend exists this settles on empty. */
export function useSongwriting(slug: string, initial?: SongwritingData): SongwritingState {
  const [state, setState] = useState<SongwritingState>({ loading: !initial, data: initial ?? EMPTY_SONGWRITING });
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    songwritingApi(slug)
      .load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setState({ loading: false, data: result.data });
      });
    return () => controller.abort();
  }, [slug, initial]);
  return state;
}
