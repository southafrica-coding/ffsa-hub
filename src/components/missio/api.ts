import { classifyContactQuery, peopleSearchParams, type PeopleQuery } from "./access";
import type {
  ContactMatch,
  CreateMissioPersonInput,
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

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "MissioApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

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

const CONFLICT_FALLBACK =
  "That couldn’t be saved. They may already be in Missio, or the email and phone belong to different people.";

function retryAfterSeconds(header: string | null): number {
  if (!header) return 60;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) return Math.ceil(asNumber);
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return 60;
}

async function parseResponse(res: Response): Promise<Record<string, unknown>> {
  const body = await readBody(res);
  if (res.status === 401) throw new MissioApiError(401, "Not signed in");
  if (res.status === 403) throw new MissioApiError(403, "No Missio pastor role");
  if (res.status === 404) throw new MissioApiError(404, "This person couldn’t be found");
  if (res.status === 409) throw new MissioApiError(409, errorMessage(body, CONFLICT_FALLBACK));
  if (res.status === 429) {
    const seconds = retryAfterSeconds(res.headers.get("retry-after"));
    throw new MissioApiError(429, `Too many searches, try again in ${seconds} seconds`, seconds);
  }
  if (!res.ok) throw new MissioApiError(res.status, errorMessage(body, "Missio didn’t respond."));
  return body;
}

function asPerson(value: unknown): MissioPerson {
  if (!value || typeof value !== "object") {
    throw new MissioApiError(500, "Missio returned an unexpected person.");
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
        throw new MissioApiError(500, "Missio returned an unexpected profile.");
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
      const kind = classifyContactQuery(q);
      if (kind === "empty") {
        throw new MissioApiError(400, "Enter an email address or a phone number.");
      }
      if (kind === "name") {
        throw new MissioApiError(400, "Search accepts an email address or a phone number, not a name.");
      }
      const params = new URLSearchParams({ q: q.trim() });
      const body = await request(`${missioApi.contactSearch}?${params.toString()}`);
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
