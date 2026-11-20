import { capRetryAfterSeconds, MissioApiError } from "../api";
import type {
  HouseCampus,
  HouseDetail,
  HouseDetailResponse,
  HouseListResponse,
  HouseMember,
  HouseRole,
  HouseSummary,
  MemberMutationResponse,
  PersonRef,
  ResolveBody,
  ResolveResponse,
  ReviewContactMatch,
  CoachResponse,
  FeedbackHistoryResponse,
  FeedbackHouse,
  CoachRef,
  ReviewContactSearchResponse,
  ReviewHouseRef,
  ReviewItem,
  ReviewListResponse,
  ReviewStatus,
} from "./types";

/**
 * Fetchers for `/api/missio/house-churches`. Kept apart from the people
 * client so a field rename stays in this file.
 */
export const houseChurchesApi = {
  list: "/api/missio/house-churches",
  house: (id: string) => `/api/missio/house-churches/${encodeURIComponent(id)}`,
  members: (id: string) => `/api/missio/house-churches/${encodeURIComponent(id)}/members`,
  coach: (houseId: string) => `/api/missio/house-churches/${encodeURIComponent(houseId)}/coach`,
  member: (houseId: string, contactId: string) =>
    `/api/missio/house-churches/${encodeURIComponent(houseId)}/members/${encodeURIComponent(contactId)}`,
  review: "/api/missio/house-churches/import-review",
  resolve: (itemId: string) =>
    `/api/missio/house-churches/import-review/${encodeURIComponent(itemId)}/resolve`,
  reviewContacts: (q: string) =>
    `/api/missio/house-churches/import-review/contacts?q=${encodeURIComponent(q)}`,
} as const;

const fieldErrorLines = new WeakMap<MissioApiError, string[]>();
const existingMatches = new WeakMap<MissioApiError, ReviewContactMatch[]>();

/** Who a refused create collided with, when the server named them. Review queue only. */
export function houseErrorMatches(error: unknown): ReviewContactMatch[] {
  return error instanceof MissioApiError ? existingMatches.get(error) ?? [] : [];
}

export const GENERIC_HOUSE_ERROR = "That didn’t work. Try again.";

/** Fixed copy for a house-church error. Never reads the server's message string. */
export function houseErrorCopy(error: MissioApiError, surface?: "role" | "review"): string {
  const seconds = capRetryAfterSeconds(error.retryAfterSeconds);
  const fields = fieldErrorLines.get(error) ?? [];
  switch (error.code) {
    case "invalid_input":
      return fields.length > 0 ? fields.join(" ") : "Check the details and try again.";
    case "not_missio_person":
      if (surface === "role") return "This person isn’t part of Missio, so their role can’t be changed here.";
      if (surface === "review") {
        return "That didn’t match a new person. If they are already in the Hub, find them under Search everyone and link them.";
      }
      return "This person isn’t in Missio yet. Add them in Missio People first.";
    case "not_found":
      return "That couldn’t be found.";
    case "already_member":
      return "They’re already in this house.";
    case "already_resolved":
      return "Someone else already sorted this one.";
    case "membership_not_current":
      return "They’re no longer in this house.";
    case "member_left_missio":
      return "They’ve left Missio, so they can’t be changed here.";
    case "ended_at_in_future":
      return "That end date is still in the future.";
    case "rate_limited":
      return `Too many attempts, try again in ${seconds} seconds`;
    case "server_error":
      return "Something went wrong on our side. Try again.";
    case "unauthenticated":
      return "Not signed in";
    case "forbidden":
      return "Pastors only";
    default:
      return GENERIC_HOUSE_ERROR;
  }
}

export interface HouseChurchesClient {
  listHouses(): Promise<HouseListResponse>;
  getHouse(id: string): Promise<HouseDetailResponse>;
  addMember(houseId: string, body: { contactId: string; role: HouseRole }): Promise<MemberMutationResponse>;
  updateMemberRole(houseId: string, contactId: string, role: HouseRole): Promise<MemberMutationResponse>;
  removeMember(houseId: string, contactId: string): Promise<{ ok: true }>;
  /** Weekly feedback for every house this user may see. */
  feedbackHistory(weeks?: number): Promise<FeedbackHistoryResponse>;
  /** The house's weekly feedback link (made on first use). rotate: pastors only. */
  feedbackLink(houseId: string, rotate?: boolean): Promise<{ path: string }>;
  /** Add or remove one of the house's coaches. Pastors only. */
  setCoach(houseId: string, contactId: string, on: boolean): Promise<CoachResponse>;
  listReview(): Promise<ReviewListResponse>;
  resolveReview(itemId: string, body: ResolveBody): Promise<ResolveResponse>;
  /** Name search across every contact. Pastors only, review queue only. */
  searchReviewContacts(q: string): Promise<ReviewContactSearchResponse>;
}

type FetchLike = typeof fetch;

const UNEXPECTED = "House churches came back in an unexpected shape.";

function codeFor(body: Record<string, unknown>, status: number): string {
  const raw = body.code;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "invalid_input";
  if (status === 429) return "rate_limited";
  return "server_error";
}

const FIELD_COPY: Record<string, string> = {
  contactId: "Pick someone from Missio.",
  role: "Choose a role.",
  startedAt: "Check the start date.",
  firstName: "Enter a first name.",
  lastName: "Check the last name.",
  email: "Check the email address.",
  phone: "Check the phone number.",
  notes: "Check the note.",
  action: "Choose what to do with this name.",
};

const UNKNOWN_FIELD = "Check this field.";

function fieldCopy(key: string): string {
  if (FIELD_COPY[key]) return FIELD_COPY[key];
  const leaf = key.split(".").filter(Boolean).pop() ?? "";
  return FIELD_COPY[leaf] ?? UNKNOWN_FIELD;
}

/** Fixed copy for each field key. The server's strings are never used. */
function readFieldErrors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    const line = fieldCopy(trimmed);
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

function retryAfterSeconds(header: string | null): number {
  if (!header) return 60;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) return capRetryAfterSeconds(asNumber);
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return capRetryAfterSeconds(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
  return 60;
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function parseResponse(res: Response): Promise<Record<string, unknown>> {
  const body = await readBody(res);
  if (res.ok) return body;
  const code = codeFor(body, res.status);
  const seconds = code === "rate_limited" ? retryAfterSeconds(res.headers.get("retry-after")) : null;
  const fields = code === "invalid_input" ? readFieldErrors(body.fieldErrors) : [];
  const error = new MissioApiError(res.status, "", seconds, code);
  fieldErrorLines.set(error, fields);
  if (Array.isArray(body.matches)) {
    try {
      existingMatches.set(error, body.matches.slice(0, 5).map(contactMatch));
    } catch {
      // A malformed match list is dropped. The error itself still shows.
    }
  }
  error.message = houseErrorCopy(error);
  throw error;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function campusOf(value: unknown): HouseCampus {
  if (value === "potch" || value === "jhb") return value;
  throw new MissioApiError(500, UNEXPECTED, null, "server_error");
}

function roleOf(value: unknown): HouseRole {
  if (value === "leader" || value === "co_leader" || value === "member") return value;
  throw new MissioApiError(500, UNEXPECTED, null, "server_error");
}

function personRef(value: unknown): PersonRef {
  const row = asRecord(value);
  if (!row || typeof row.contactId !== "string" || typeof row.displayName !== "string") {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  const person: PersonRef = {
    contactId: row.contactId,
    displayName: row.displayName,
    firstName: optionalString(row.firstName),
    lastName: optionalString(row.lastName),
  };
  if (typeof row.orgPersonId === "string" && row.orgPersonId) person.orgPersonId = row.orgPersonId;
  if (typeof row.hint === "string" && row.hint) person.hint = row.hint;
  return person;
}

function people(value: unknown): PersonRef[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return value.map(personRef);
}

function coachesOf(value: unknown): CoachRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ ...personRef(item), since: optionalString(asRecord(item)?.since) }));
}

function summary(value: unknown): HouseSummary {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.number !== "number" || typeof row.memberCount !== "number") {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  return {
    id: row.id,
    number: row.number,
    name: optionalString(row.name),
    campus: campusOf(row.campus),
    meetingDay: optionalString(row.meetingDay),
    location: optionalString(row.location),
    memberCount: row.memberCount,
    kidsCount: typeof row.kidsCount === "number" ? row.kidsCount : 0,
    ...(typeof row.readyToLead === "number" ? { readyToLead: row.readyToLead } : {}),
    leaders: people(row.leaders),
    coLeaders: people(row.coLeaders),
    coaches: coachesOf(row.coaches),
  };
}

function memberOf(value: unknown): HouseMember {
  const row = asRecord(value);
  if (!row) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return {
    ...personRef(row),
    role: roleOf(row.role),
    startedAt: optionalString(row.startedAt),
  };
}

function detailOf(value: unknown): HouseDetail {
  const row = asRecord(value);
  if (!row || !Array.isArray(row.members)) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return {
    ...summary(row),
    leaderNotes: optionalString(row.leaderNotes),
    members: row.members.map(memberOf),
  };
}

const REVIEW_STATUS = new Set<ReviewStatus>(["pending", "matched", "new", "skipped"]);

function reviewHouse(value: unknown): ReviewHouseRef | null {
  if (value == null) return null;
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.number !== "number") {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  return { id: row.id, number: row.number, name: optionalString(row.name) };
}

function sourceLineOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function nullableText(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

function optionalRole(value: unknown): HouseRole | null {
  if (value == null) return null;
  return value === "leader" || value === "co_leader" || value === "member" ? value : null;
}

function reviewItem(value: unknown): ReviewItem {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.rawName !== "string" ||
    typeof row.houseNumber !== "number" ||
    !REVIEW_STATUS.has(row.status as ReviewStatus)
  ) {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  return {
    id: row.id,
    status: row.status as ReviewStatus,
    sourceLine: sourceLineOf(row.sourceLine),
    rawName: row.rawName,
    kind: nullableText(row.kind),
    matchType: nullableText(row.matchType),
    houseNumber: row.houseNumber,
    house: reviewHouse(row.house),
    role: optionalRole(row.role),
    candidates: people(row.candidates),
    notes: nullableText(row.note),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    resolvedAt: nullableText(row.resolvedAt),
  };
}

function abilitiesOf(body: Record<string, unknown>, canWrite: boolean) {
  const raw = asRecord(body.abilities);
  if (!raw) return { place: canWrite, editMembers: canWrite };
  return { place: raw.place === true, editMembers: raw.editMembers === true };
}

function listResponse(body: Record<string, unknown>): HouseListResponse {
  if (!Array.isArray(body.houses) || typeof body.canWrite !== "boolean") {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  return { houses: body.houses.map(summary), canWrite: body.canWrite, abilities: abilitiesOf(body, body.canWrite) };
}

function detailResponse(body: Record<string, unknown>): HouseDetailResponse {
  if (typeof body.canWrite !== "boolean") throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return { house: detailOf(body.house), canWrite: body.canWrite, abilities: abilitiesOf(body, body.canWrite) };
}

function memberResponse(body: Record<string, unknown>): MemberMutationResponse {
  return { member: memberOf(body.member) };
}

function reviewResponse(body: Record<string, unknown>): ReviewListResponse {
  if (!Array.isArray(body.items)) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return { items: body.items.map(reviewItem) };
}

function contactMatch(value: unknown): ReviewContactMatch {
  return { ...personRef(value), inMissio: asRecord(value)?.inMissio === true };
}

function contactSearchResponse(body: Record<string, unknown>): ReviewContactSearchResponse {
  if (!Array.isArray(body.matches)) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return { matches: body.matches.map(contactMatch) };
}

function resolveResponse(body: Record<string, unknown>): ResolveResponse {
  const response: ResolveResponse = { item: reviewItem(body.item) };
  if (body.member != null) {
    const member = asRecord(body.member);
    if (!member || typeof member.contactId !== "string") {
      throw new MissioApiError(500, UNEXPECTED, null, "server_error");
    }
    response.member = { contactId: member.contactId, role: roleOf(member.role) };
  }
  return response;
}

export function createHouseChurchesClient(fetchImpl: FetchLike = fetch): HouseChurchesClient {
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
    async listHouses() {
      return listResponse(await request(houseChurchesApi.list));
    },
    async getHouse(id) {
      return detailResponse(await request(houseChurchesApi.house(id)));
    },
    async addMember(houseId, body) {
      return memberResponse(
        await request(houseChurchesApi.members(houseId), {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async updateMemberRole(houseId, contactId, role) {
      return memberResponse(
        await request(houseChurchesApi.member(houseId, contactId), {
          method: "PATCH",
          body: JSON.stringify({ role }),
        })
      );
    },
    async removeMember(houseId, contactId) {
      const body = await request(houseChurchesApi.member(houseId, contactId), { method: "DELETE" });
      if (body.ok !== true) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
      return { ok: true };
    },
    async setCoach(houseId, contactId, on) {
      const body = await request(houseChurchesApi.coach(houseId), {
        method: "PUT",
        body: JSON.stringify({ contactId, on }),
      });
      return { coaches: coachesOf(body.coaches) };
    },
    async feedbackHistory(weeks = 12) {
      const body = await request(`/api/missio/house-churches/feedback?weeks=${encodeURIComponent(String(weeks))}`);
      if (!Array.isArray(body.houses)) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
      return { houses: body.houses as FeedbackHouse[], since: String(body.since ?? "") };
    },
    async feedbackLink(houseId, rotate = false) {
      const body = await request(`/api/missio/house-churches/${encodeURIComponent(houseId)}/feedback/link`, {
        method: "POST",
        body: JSON.stringify({ rotate }),
      });
      if (typeof body.path !== "string") throw new MissioApiError(500, UNEXPECTED, null, "server_error");
      return { path: body.path };
    },
    async listReview() {
      return reviewResponse(await request(`${houseChurchesApi.review}?status=pending`));
    },
    async resolveReview(itemId, body) {
      return resolveResponse(
        await request(houseChurchesApi.resolve(itemId), {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async searchReviewContacts(q) {
      return contactSearchResponse(await request(houseChurchesApi.reviewContacts(q)));
    },
  };
}

export const houseChurchesClient = createHouseChurchesClient();
