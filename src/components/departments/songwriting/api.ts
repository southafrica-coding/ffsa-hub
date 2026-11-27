// Songwriting client for the #756 API at /api/departments/[slug]/songwriting
// (P&W only: any other slug is a 404). Reads use readOr: a 403 is denied,
// not empty. Writes use requestJson and report a code and fieldErrors keys,
// never the server's text. Bodies are built in payloads.ts, so created_by,
// by and last_contact_at are never sent.

import { readOr, requestJson } from "@/components/song-library/client";
import type { PwNation, PwSongwritingTraining, PwTrainingFacilitator } from "@/lib/departments/db.types";
import { contactPayload, leadPayload, nationPayload, trainingPayload } from "./payloads";
import {
  EMPTY_SONGWRITING,
  type ContactInput,
  type LeadInput,
  type NationInput,
  type SongwritingData,
  type SongwritingLead,
  type SongwritingLeadEvent,
  type TrainingInput,
} from "./types";

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
    leadEvent: (id: string, eventId: string) => `${base}/leads/${enc(id)}/events/${enc(eventId)}`,
  };
}

/** Fills anything an older or partial answer left out, so pages never read undefined. */
export function normaliseData(raw: Partial<SongwritingData> | null | undefined): SongwritingData {
  return {
    ...EMPTY_SONGWRITING,
    ...(raw ?? {}),
    nations: (raw?.nations ?? []).map((n) => ({ ...n, iso_code: n.iso_code ?? null, languages: n.languages ?? [] })),
    viewer: raw?.viewer ?? null,
  };
}

type TrainingReply = { training: PwSongwritingTraining; facilitators: PwTrainingFacilitator[] };
type LeadReply = { lead: SongwritingLead };

export function songwritingApi(slug: string) {
  const r = songwritingRoutes(slug);
  return {
    load: async (signal?: AbortSignal) => {
      const result = await readOr<SongwritingData>(r.data, EMPTY_SONGWRITING, signal);
      return { ...result, data: normaliseData(result.data) };
    },

    createTraining: (input: TrainingInput) => requestJson<TrainingReply>(r.trainings, { method: "POST", body: trainingPayload(input) }),
    updateTraining: (id: string, input: TrainingInput) =>
      requestJson<TrainingReply>(r.training(id), { method: "PATCH", body: trainingPayload(input) }),
    deleteTraining: (id: string) => requestJson<{ deleted: string }>(r.training(id), { method: "DELETE" }),

    createNation: (input: NationInput) => requestJson<{ nation: PwNation }>(r.nations, { method: "POST", body: nationPayload(input) }),
    updateNation: (id: string, input: NationInput) =>
      requestJson<{ nation: PwNation }>(r.nation(id), { method: "PATCH", body: nationPayload(input) }),
    deleteNation: (id: string) => requestJson<{ deleted: string }>(r.nation(id), { method: "DELETE" }),

    loadLead: (id: string, signal?: AbortSignal) =>
      requestJson<{ lead: SongwritingLead; events: SongwritingLeadEvent[] }>(r.lead(id), { signal }),
    createLead: (input: LeadInput) => requestJson<LeadReply>(r.leads, { method: "POST", body: leadPayload(input) }),
    updateLead: (id: string, input: LeadInput) => requestJson<LeadReply>(r.lead(id), { method: "PATCH", body: leadPayload(input) }),
    deleteLead: (id: string) => requestJson<{ deleted: string }>(r.lead(id), { method: "DELETE" }),

    logContact: (leadId: string, input: ContactInput | string) =>
      requestJson<{ lead: SongwritingLead; event: SongwritingLeadEvent }>(r.leadEvents(leadId), {
        method: "POST",
        body: contactPayload(typeof input === "string" ? { note: input } : input),
      }),
    /** The person who logged it, or an admin. */
    deleteContact: (leadId: string, eventId: string) =>
      requestJson<{ lead: SongwritingLead; deleted: string }>(r.leadEvent(leadId, eventId), { method: "DELETE" }),
  };
}

export type SongwritingApi = ReturnType<typeof songwritingApi>;
