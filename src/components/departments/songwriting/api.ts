// Songwriting client, aimed at the future
// /api/departments/[slug]/songwriting routes. There is no backend PR yet:
// a missing route reads as empty and the pages show their empty states.

import { readOr, requestJson } from "@/components/song-library/client";
import type { PwSongwritingTraining } from "@/lib/departments/db.types";
import { EMPTY_SONGWRITING, type SongwritingData, type SongwritingLead, type TrainingInput } from "./types";

const enc = encodeURIComponent;

export function songwritingRoutes(slug: string) {
  const base = `/api/departments/${enc(slug)}/songwriting`;
  return {
    data: base,
    trainings: `${base}/trainings`,
    training: (id: string) => `${base}/trainings/${enc(id)}`,
    nations: `${base}/nations`,
    nation: (id: string) => `${base}/nations/${enc(id)}`,
    leads: `${base}/leads`,
    lead: (id: string) => `${base}/leads/${enc(id)}`,
    leadEvents: (id: string) => `${base}/leads/${enc(id)}/events`,
  };
}

export function songwritingApi(slug: string) {
  const r = songwritingRoutes(slug);
  return {
    load: (signal?: AbortSignal) => readOr<SongwritingData>(r.data, EMPTY_SONGWRITING, signal),
    createTraining: (input: TrainingInput) =>
      requestJson<{ training: PwSongwritingTraining }>(r.trainings, { method: "POST", body: input }),
    updateTraining: (id: string, input: TrainingInput) =>
      requestJson<{ training: PwSongwritingTraining }>(r.training(id), { method: "PATCH", body: input }),
    deleteTraining: (id: string) => requestJson<unknown>(r.training(id), { method: "DELETE" }),
    logContact: (leadId: string, note: string) =>
      requestJson<{ lead: SongwritingLead }>(r.leadEvents(leadId), { method: "POST", body: { note } }),
  };
}

export type SongwritingApi = ReturnType<typeof songwritingApi>;
