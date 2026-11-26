import { capRetryAfterSeconds, MissioApiError } from "../api";
import type { PersonRef } from "../house-churches/types";
import type {
  FollowUpItem,
  FollowUpListResponse,
  FollowUpMutation,
  FollowUpSource,
  FollowUpStage,
  LeaderListResponse,
  TimelineEntry,
  TimelineKind,
  TimelineResponse,
  VisitType,
} from "./types";

const UNEXPECTED = "server_error";

export const followUpApi = {
  list: "/api/missio/follow-up",
  leaders: "/api/missio/follow-up/leaders",
  item: (key: string) => `/api/missio/follow-up/${encodeURIComponent(key)}`,
  stage: (key: string) => `/api/missio/follow-up/${encodeURIComponent(key)}/stage`,
  leader: (key: string) => `/api/missio/follow-up/${encodeURIComponent(key)}/leader`,
  timeline: (key: string) => `/api/missio/follow-up/${encodeURIComponent(key)}/timeline`,
  contact: (key: string) => `/api/missio/follow-up/${encodeURIComponent(key)}/contact`,
  /** Provisional until Hub Data finishes decline. */
  confirmMatch: (key: string) => `/api/missio/followups/${encodeURIComponent(key)}/confirm-match`,
  declineMatch: (key: string) => `/api/missio/followups/${encodeURIComponent(key)}/decline-match`,
} as const;

export interface FollowUpClient {
  list(query: { stage: FollowUpStage; leader?: string | null }): Promise<FollowUpListResponse>;
  leaders(): Promise<LeaderListResponse>;
  setStage(key: string, body: { stage: FollowUpStage; note?: string }): Promise<FollowUpMutation>;
  setLeader(key: string, leaderContactId: string | null): Promise<FollowUpMutation>;
  timeline(key: string): Promise<TimelineResponse>;
  addNote(key: string, body: string): Promise<{ entry: TimelineEntry }>;
  createContact(key: string): Promise<{ person: FollowUpItem }>;
  confirmMatch(key: string): Promise<{ person: FollowUpItem | null }>;
  declineMatch(key: string): Promise<{ person: FollowUpItem | null }>;
}

type FetchLike = typeof fetch;

const STAGES = new Set<FollowUpStage>(["new", "contacted", "visited_house", "joined"]);
const VISITS = new Set<VisitType>(["first_time", "been_a_while", "regular"]);
const KINDS = new Set<TimelineKind>(["submitted", "stage_change", "note"]);

function shape(): never {
  throw new MissioApiError(500, "", null, UNEXPECTED);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stageOrNull(value: unknown): FollowUpStage | null {
  return typeof value === "string" && STAGES.has(value as FollowUpStage) ? (value as FollowUpStage) : null;
}

function personRef(value: unknown): PersonRef {
  const row = asRecord(value);
  if (!row || typeof row.contactId !== "string" || typeof row.displayName !== "string") shape();
  const person: PersonRef = {
    contactId: row.contactId,
    displayName: row.displayName,
    firstName: stringOrNull(row.firstName),
    lastName: stringOrNull(row.lastName),
  };
  if (typeof row.orgPersonId === "string" && row.orgPersonId) person.orgPersonId = row.orgPersonId;
  return person;
}

export function followUpItem(value: unknown): FollowUpItem {
  const row = asRecord(value);
  if (!row || typeof row.key !== "string" || typeof row.displayName !== "string") shape();
  const source: FollowUpSource | null =
    row.source === "contact" || row.source === "connect_response" ? row.source : null;
  const stage = stageOrNull(row.stage);
  if (!source || !stage) shape();
  const visit = typeof row.visitType === "string" && VISITS.has(row.visitType as VisitType) ? (row.visitType as VisitType) : null;
  const suggested = asRecord(row.suggestedContact);
  const suggestedContact =
    suggested && typeof suggested.contactId === "string" && typeof suggested.displayName === "string"
      ? { contactId: suggested.contactId, displayName: suggested.displayName }
      : null;
  return {
    key: row.key,
    source,
    contactId: stringOrNull(row.contactId),
    connectResponseId: stringOrNull(row.connectResponseId),
    followupId: stringOrNull(row.followupId),
    displayName: row.displayName,
    phone: stringOrNull(row.phone),
    email: stringOrNull(row.email),
    visitType: visit,
    wantsHouseChurch: boolOrNull(row.wantsHouseChurch),
    wantsPrayer: boolOrNull(row.wantsPrayer),
    stage,
    assignedLeader: row.assignedLeader == null ? null : personRef(row.assignedLeader),
    submittedAt: stringOrNull(row.submittedAt),
    matchStatus: typeof row.matchStatus === "string" ? row.matchStatus : null,
    suggestedContact,
  };
}

function entryOf(value: unknown): TimelineEntry {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.at !== "string") shape();
  if (typeof row.kind !== "string" || !KINDS.has(row.kind as TimelineKind)) shape();
  const by = asRecord(row.by);
  return {
    id: row.id,
    kind: row.kind as TimelineKind,
    fromStage: stageOrNull(row.fromStage),
    toStage: stageOrNull(row.toStage),
    body: stringOrNull(row.body),
    by: by && typeof by.displayName === "string" ? { displayName: by.displayName } : null,
    at: row.at,
  };
}

function listResponse(body: Record<string, unknown>): FollowUpListResponse {
  if (!Array.isArray(body.people) || typeof body.canWrite !== "boolean") shape();
  return { people: body.people.map(followUpItem), canWrite: body.canWrite };
}

function mutationResponse(body: Record<string, unknown>): FollowUpMutation {
  return { person: followUpItem(body.person), entry: entryOf(body.entry) };
}

function retryAfterSeconds(header: string | null): number {
  if (!header) return 60;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) return capRetryAfterSeconds(asNumber);
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return capRetryAfterSeconds(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
  return 60;
}

function codeFor(body: Record<string, unknown>, status: number): string {
  if (typeof body.code === "string" && body.code.trim()) return body.code;
  if (status === 400) return "invalid_input";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "already_resolved";
  if (status === 429) return "rate_limited";
  if (status === 501) return "not_available";
  return "server_error";
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

async function parseResponse(res: Response): Promise<Record<string, unknown>> {
  const body = await readBody(res);
  if (res.ok) return body;
  const code = codeFor(body, res.status);
  const seconds = code === "rate_limited" ? retryAfterSeconds(res.headers.get("retry-after")) : null;
  throw new MissioApiError(res.status, "", seconds, code);
}

export function followUpListPath(query: { stage: FollowUpStage; leader?: string | null }): string {
  const params = new URLSearchParams();
  params.set("stage", query.stage);
  if (query.leader) params.set("leader", query.leader);
  return `${followUpApi.list}?${params.toString()}`;
}

export function createFollowUpClient(fetchImpl: FetchLike = fetch): FollowUpClient {
  async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetchImpl(url, {
      ...init,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    return parseResponse(res);
  }

  return {
    async list(query) {
      return listResponse(await request(followUpListPath(query)));
    },
    async leaders() {
      const body = await request(followUpApi.leaders);
      if (!Array.isArray(body.leaders)) shape();
      return { leaders: body.leaders.map(personRef) };
    },
    async setStage(key, body) {
      const payload: { stage: FollowUpStage; note?: string } = { stage: body.stage };
      const note = body.note?.trim();
      if (note) payload.note = note;
      return mutationResponse(await request(followUpApi.stage(key), { method: "PATCH", body: JSON.stringify(payload) }));
    },
    async setLeader(key, leaderContactId) {
      return mutationResponse(
        await request(followUpApi.leader(key), {
          method: "PATCH",
          body: JSON.stringify({ leaderContactId }),
        })
      );
    },
    async timeline(key) {
      const body = await request(followUpApi.timeline(key));
      if (!Array.isArray(body.entries)) shape();
      return { entries: body.entries.map(entryOf) };
    },
    async addNote(key, body) {
      const parsed = await request(followUpApi.timeline(key), {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      return { entry: entryOf(parsed.entry) };
    },
    async createContact(key) {
      const parsed = await request(followUpApi.contact(key), { method: "POST" });
      return { person: followUpItem(parsed.person) };
    },
    async confirmMatch(key) {
      const parsed = await request(followUpApi.confirmMatch(key), { method: "POST" });
      return { person: parsed.person == null ? null : followUpItem(parsed.person) };
    },
    async declineMatch(key) {
      const parsed = await request(followUpApi.declineMatch(key), { method: "POST" });
      return { person: parsed.person == null ? null : followUpItem(parsed.person) };
    },
  };
}

export const followUpClient = createFollowUpClient();
