import { capRetryAfterSeconds, MissioApiError } from "../api";
import type {
  HouseCampus,
  HouseDetail,
  HouseDetailResponse,
  HouseErrorCode,
  HouseListResponse,
  HouseMember,
  HouseRole,
  HouseSummary,
  MemberMutationResponse,
  PersonRef,
  ResolveBody,
  ResolveResponse,
  ReviewHouseRef,
  ReviewItem,
  ReviewKind,
  ReviewListResponse,
  ReviewMatchType,
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
  member: (houseId: string, contactId: string) =>
    `/api/missio/house-churches/${encodeURIComponent(houseId)}/members/${encodeURIComponent(contactId)}`,
  review: "/api/missio/house-churches/import-review",
  resolve: (itemId: string) =>
    `/api/missio/house-churches/import-review/${encodeURIComponent(itemId)}/resolve`,
} as const;

const HOUSE_CODES = new Set<HouseErrorCode>([
  "unauthenticated",
  "forbidden",
  "invalid_input",
  "not_found",
  "already_member",
  "already_resolved",
  "exists_use_search",
  "rate_limited",
  "server_error",
]);

export interface HouseChurchesClient {
  listHouses(): Promise<HouseListResponse>;
  getHouse(id: string): Promise<HouseDetailResponse>;
  addMember(houseId: string, body: { contactId: string; role: HouseRole }): Promise<MemberMutationResponse>;
  updateMemberRole(houseId: string, contactId: string, role: HouseRole): Promise<MemberMutationResponse>;
  removeMember(houseId: string, contactId: string): Promise<{ ok: true }>;
  listReview(): Promise<ReviewListResponse>;
  resolveReview(itemId: string, body: ResolveBody): Promise<ResolveResponse>;
}

type FetchLike = typeof fetch;

const UNEXPECTED = "House churches came back in an unexpected shape.";

export function houseErrorCopy(error: MissioApiError, fallback: string): string {
  const seconds = capRetryAfterSeconds(error.retryAfterSeconds);
  switch (error.code) {
    case "unauthenticated":
      return "Not signed in";
    case "forbidden":
      return "Pastors only";
    case "not_found":
      return "That couldn’t be found";
    case "already_member":
      return "Already in this house";
    case "already_resolved":
      return "This name was already resolved";
    case "exists_use_search":
      return "This person is already in FFSA’s contacts. Search for them and link them.";
    case "invalid_input":
      return error.message || "Check the details and try again.";
    case "rate_limited":
      return `Too many attempts, try again in ${seconds} seconds`;
    default:
      return fallback;
  }
}

function codeFor(body: Record<string, unknown>, status: number): HouseErrorCode {
  const raw = body.code;
  if (typeof raw === "string" && HOUSE_CODES.has(raw as HouseErrorCode)) return raw as HouseErrorCode;
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "invalid_input";
  if (status === 429) return "rate_limited";
  return "server_error";
}

function messageFor(code: HouseErrorCode, body: Record<string, unknown>, seconds: number | null): string {
  if (code === "invalid_input") {
    if (typeof body.error === "string" && body.error.trim()) return body.error;
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  }
  return houseErrorCopy(new MissioApiError(0, "", seconds, code), "House churches didn’t load.");
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
  throw new MissioApiError(res.status, messageFor(code, body, seconds), seconds, code);
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
  return person;
}

function people(value: unknown): PersonRef[] {
  if (!Array.isArray(value)) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return value.map(personRef);
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
    leaders: people(row.leaders),
    coLeaders: people(row.coLeaders),
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
const MATCH_TYPES = new Set<ReviewMatchType>(["none", "multiple", "family_label", "first_only", "partial"]);

function reviewHouse(value: unknown): ReviewHouseRef | null {
  if (value == null) return null;
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.number !== "number") {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  return { id: row.id, number: row.number, name: optionalString(row.name) };
}

function reviewItem(value: unknown): ReviewItem {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.sourceLine !== "string" ||
    typeof row.rawName !== "string" ||
    typeof row.houseNumber !== "number" ||
    typeof row.kind !== "string" ||
    !REVIEW_STATUS.has(row.status as ReviewStatus) ||
    !MATCH_TYPES.has(row.matchType as ReviewMatchType)
  ) {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  return {
    id: row.id,
    status: row.status as ReviewStatus,
    sourceLine: row.sourceLine,
    rawName: row.rawName,
    kind: row.kind as ReviewKind,
    matchType: row.matchType as ReviewMatchType,
    houseNumber: row.houseNumber,
    house: reviewHouse(row.house),
    role: row.role == null ? null : roleOf(row.role),
    candidates: people(row.candidates ?? []),
    notes: optionalString(row.notes),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    resolvedAt: optionalString(row.resolvedAt),
  };
}

function listResponse(body: Record<string, unknown>): HouseListResponse {
  if (!Array.isArray(body.houses) || typeof body.canWrite !== "boolean") {
    throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  }
  return { houses: body.houses.map(summary), canWrite: body.canWrite };
}

function detailResponse(body: Record<string, unknown>): HouseDetailResponse {
  if (typeof body.canWrite !== "boolean") throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return { house: detailOf(body.house), canWrite: body.canWrite };
}

function memberResponse(body: Record<string, unknown>): MemberMutationResponse {
  return { member: memberOf(body.member) };
}

function reviewResponse(body: Record<string, unknown>): ReviewListResponse {
  if (!Array.isArray(body.items)) throw new MissioApiError(500, UNEXPECTED, null, "server_error");
  return { items: body.items.map(reviewItem) };
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
  };
}

export const houseChurchesClient = createHouseChurchesClient();
