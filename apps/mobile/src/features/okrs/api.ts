// The OKR screens' calls to the website's API, as the signed-in person
// (bearer token). Pure: give it an ApiFetch, so it is testable without a
// session. The live instance is in client.ts.
//
//   GET  /api/mobile/okrs?cycle=          the wall (new, read-only)
//   GET  /api/mobile/okrs/[ownerId]?cycle= one group's OKRs + canEdit (new, read-only)
//   GET  /api/okrs/key-results/[id]/checkins   check-in log (existing)
//   POST /api/okrs/key-results/[id]/checkins   new check-in (existing; the
//        server re-checks that the caller leads the group, RLS decides)

import type { ApiFetch } from "@/lib/api";

import type { CheckinBody } from "./logic";
import { checkinsResponseSchema, ownerPageSchema, wallSchema, type Checkin, type OwnerPage, type Wall } from "./types";

const withCycle = (path: string, cycle: string | null | undefined) =>
  cycle ? `${path}?cycle=${encodeURIComponent(cycle)}` : path;

export function createOkrsApi(apiFetch: ApiFetch) {
  return {
    loadWall(cycle: string | null): Promise<Wall> {
      return apiFetch(withCycle("/api/mobile/okrs", cycle), { schema: wallSchema });
    },
    loadOwner(ownerId: string, cycle: string | null): Promise<OwnerPage> {
      return apiFetch(withCycle(`/api/mobile/okrs/${encodeURIComponent(ownerId)}`, cycle), { schema: ownerPageSchema });
    },
    loadCheckins(keyResultId: string, signal?: AbortSignal): Promise<Checkin[]> {
      return apiFetch(`/api/okrs/key-results/${encodeURIComponent(keyResultId)}/checkins`, {
        schema: checkinsResponseSchema,
        signal,
      });
    },
    async postCheckin(keyResultId: string, body: CheckinBody): Promise<void> {
      await apiFetch(`/api/okrs/key-results/${encodeURIComponent(keyResultId)}/checkins`, { method: "POST", body });
    },
  };
}

export type OkrsApi = ReturnType<typeof createOkrsApi>;
