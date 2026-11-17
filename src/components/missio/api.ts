import { classifyContactQuery, peopleSearchParams, type PeopleQuery } from "./access";
import type {
  ContactMatch,
  CreateMissioPersonInput,
  MissioErrorCode,
  MissioMe,
  MissioPerson,
  UpdateMissioPersonInput,
} from "./types-shim";

/**
 * Every Missio request the UI makes. People, contact match, and the viewer
 * profile stay on these paths — never the FFSA contacts or labels APIs.
 * A database trigger applies the Missio contact label; this client never sends one.
 */
export const missioApi = {
  me: "/api/missio/me",
  people: "/api/missio/people",
  person: (id: string) => `/api/missio/people/${encodeURIComponent(id)}`,
  contactSearch: "/api/missio/contacts/search",
} as const;

export class MissioApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly code: string | null;

  constructor(
    status: number,
    message: string,
    retryAfterSeconds: number | null = null,
    code: string | null = null,
  ) {
    super(message);
    this.name = "MissioApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = code;
  }
}

/** Create-form 409. The contact exists outside Missio; linking is the search path only. */
export const EXISTS_USE_SEARCH_CODE = "exists_use_search";

/** Shown instead of the raw 409 text when the create form hits an existing contact. */
export const EXISTS_USE_SEARCH_MESSAGE =
  "This person is already in FFSA's contacts. Search for them and pick Use this contact.";

const ERROR_CODES = new Set<MissioErrorCode>([
  "exists_use_search",
  "already_in_org",
  "invalid_token",
  "invalid_input",
  "rate_limited",
  "unauthenticated",
  "forbidden",
  "not_found",
  "server_error",
  "method_not_allowed",
]);

export interface PeoplePage {
  rows: MissioPerson[];
  total: number;
}

export interface CreatedPerson {
  person: MissioPerson;
  linkedExisting: boolean;
}

export interface MissioClient {
  getMe(): Promise<MissioMe>;
  listPeople(query?: PeopleQuery): Promise<PeoplePage>;
  searchContacts(q: string): Promise<{ matches: ContactMatch[] }>;
  createPerson(input: CreateMissioPersonInput): Promise<CreatedPerson>;
  updatePerson(id: string, input: UpdateMissioPersonInput): Promise<void>;
}

type FetchLike = typeof fetch;

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

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  if (typeof body.error === "string" && body.error.trim()) return body.error;
  return fallback;
}

/** A lockout longer than this is treated as ten minutes. */
export const MAX_RETRY_AFTER_SECONDS = 10 * 60;

/** Clamp a Retry-After value. Missing or unreadable values wait 60 seconds. */
export function capRetryAfterSeconds(seconds: number | null | undefined): number {
  if (seconds == null || !Number.isFinite(seconds)) return 60;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, Math.ceil(seconds)));
}

function retryAfterSeconds(header: string | null): number {
  if (!header) return 60;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) return capRetryAfterSeconds(asNumber);
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return capRetryAfterSeconds(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
  return 60;
}

function codeFor(body: Record<string, unknown>, status: number): MissioErrorCode {
  const raw = body.code;
  if (typeof raw === "string" && ERROR_CODES.has(raw as MissioErrorCode)) return raw as MissioErrorCode;
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 409) return "already_in_org";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_input";
  return "server_error";
}

function messageFor(code: MissioErrorCode, body: Record<string, unknown>, seconds: number | null): string {
  switch (code) {
    case "exists_use_search":
      return EXISTS_USE_SEARCH_MESSAGE;
    case "already_in_org":
      return "Already in Missio";
    case "invalid_token":
      return "That match expired, search again";
    case "invalid_input":
      return errorMessage(body, "Check the details and try again.");
    case "rate_limited":
      return `Too many searches, try again in ${seconds ?? 60} seconds`;
    case "unauthenticated":
      return "Not signed in";
    case "forbidden":
      return "No Missio pastor role";
    case "not_found":
      return "This person couldn’t be found";
    default:
      return "Something went wrong, try again";
  }
}

/** Copy for a failed call. Search and add/link use different rate-limit wording. */
export function missioErrorCopy(error: MissioApiError, call: "search" | "submit"): string {
  if (error.code === "rate_limited") {
    const seconds = capRetryAfterSeconds(error.retryAfterSeconds);
    return call === "search"
      ? `Too many searches, try again in ${seconds} seconds`
      : `Too many attempts, try again in ${seconds} seconds`;
  }
  if (error.code === "invalid_input") return error.message;
  if (error.code === "exists_use_search") return EXISTS_USE_SEARCH_MESSAGE;
  if (error.code === "already_in_org") return "Already in Missio";
  if (error.code === "invalid_token") return "That match expired, search again";
  if (error.code === "not_found") return "This person couldn’t be found";
  if (error.code === "unauthenticated") return "Not signed in";
  if (error.code === "forbidden") return "No Missio pastor role";
  return "Something went wrong, try again";
}

async function parseResponse(res: Response): Promise<Record<string, unknown>> {
  const body = await readBody(res);
  if (res.ok) return body;
  const code = codeFor(body, res.status);
  const seconds = code === "rate_limited" ? retryAfterSeconds(res.headers.get("retry-after")) : null;
  throw new MissioApiError(res.status, messageFor(code, body, seconds), seconds, code);
}

function asPerson(value: unknown): MissioPerson {
  if (!value || typeof value !== "object") {
    throw new MissioApiError(500, "Missio returned an unexpected person.", null, "server_error");
  }
  return value as MissioPerson;
}

export function createMissioClient(fetchImpl: FetchLike = fetch): MissioClient {
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
    async getMe() {
      const body = await request(missioApi.me);
      if (!Array.isArray(body.orgs) || !("currentOrg" in body)) {
        throw new MissioApiError(500, "Missio returned an unexpected profile.", null, "server_error");
      }
      return body as unknown as MissioMe;
    },

    async listPeople(query: PeopleQuery = {}) {
      const params = peopleSearchParams(query);
      const body = await request(`${missioApi.people}?${params.toString()}`);
      const rows = Array.isArray(body.rows) ? (body.rows as MissioPerson[]) : [];
      const total = typeof body.total === "number" ? body.total : rows.length;
      return { rows, total };
    },

    async searchContacts(q: string) {
      // The only place the contact-search transport is built. The body is { q }.
      const kind = classifyContactQuery(q);
      if (kind === "empty") {
        throw new MissioApiError(400, "Enter an email address or a phone number.", null, "invalid_input");
      }
      if (kind === "name") {
        throw new MissioApiError(400, "Search accepts an email address or a phone number, not a name.", null, "invalid_input");
      }
      const body = await request(missioApi.contactSearch, {
        method: "POST",
        body: JSON.stringify({ q: q.trim() }),
      });
      const matches = Array.isArray(body.matches) ? (body.matches as ContactMatch[]).slice(0, 5) : [];
      return { matches };
    },

    async createPerson(input: CreateMissioPersonInput) {
      const body = await request(missioApi.people, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return {
        person: asPerson(body.person),
        linkedExisting: body.linkedExisting === true,
      };
    },

    async updatePerson(id: string, input: UpdateMissioPersonInput) {
      await request(missioApi.person(id), {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
  };
}

export const missioClient = createMissioClient();
