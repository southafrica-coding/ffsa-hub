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
  member: (houseId: string, contactId: string) =>
    `/api/missio/house-churches/${encodeURIComponent(houseId)}/members/${encodeURIComponent(contactId)}`,
  review: "/api/missio/house-churches/import-review",
  resolve: (itemId: string) =>
    `/api/missio/house-churches/import-review/${encodeURIComponent(itemId)}/resolve`,
} as const;

const fieldErrorLines = new WeakMap<MissioApiError, string[]>();

export const GENERIC_HOUSE_ERROR = "That didn’t work. Try again.";

/** Fixed copy for a house-church error. Never reads the server's message string. */
export function houseErrorCopy(error: MissioApiError): string {
  const seconds = capRetryAfterSeconds(error.retryAfterSeconds);
  const fields = fieldErrorLines.get(error) ?? [];
  switch (error.code) {
    case "invalid_input":
      return fields.length > 0 ? fields.join(" ") : "Check the details and try again.";
    case "not_missio_person":
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
    case "exists_use_search":
      return "This person already exists. Open Missio People, then Add person.";
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
  listReview(): Promise<ReviewListResponse>;
  resolveReview(itemId: string, body: ResolveBody): Promise<ResolveResponse>;
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

function readFieldErrors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const item of Object.values(value as Record<string, unknown>)) {
    const parts = Array.isArray(item) ? item : [item];
    for (const part of parts) {
      if (typeof part === "string" && part.trim()) lines.push(part.trim());
    }
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
  return person;
}

function people(value: unknown): PersonRef[] {
  if (value == null) return [];
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
    notes: nullableText(row.notes),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    resolvedAt: nullableText(row.resolvedAt),
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
