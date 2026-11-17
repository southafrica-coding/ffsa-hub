// TODO: Hub Backend owns src/lib/missio/types.ts. Do not add that file on
// this branch. The exports below match the contract Backend will publish
// (MissioMe, MissioPerson, MissioCampus, MissioStatus, ContactMatch,
// CreateMissioPersonInput, UpdateMissioPersonInput, MissioErrorCode). When
// that module merges, switch these imports over to it and delete this shim.

/** Campus stored on a Missio person. Potch is the main church. */
export type MissioCampus = "potch" | "jhb";

/** Visitor, active, or inactive. Inactive is the end state — there is no delete. */
export type MissioStatus = "visitor" | "active" | "inactive";

/** Codes returned as `{ error, code }` by every Missio route. */
export type MissioErrorCode =
  | "exists_use_search"
  | "already_in_org"
  | "invalid_token"
  | "invalid_input"
  | "rate_limited"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "server_error"
  | "method_not_allowed";

/**
 * GET /api/missio/me.
 * `currentOrg` is `"missio"` only when this viewer may open the church.
 * `rolesByOrg` is keyed by organisation slug. Phase 0 grants `pastor` only;
 * an FFSA `admin` role does not appear here unless the same person also
 * holds a Missio role, and it still does not open /missio by itself.
 */
export interface MissioMe {
  orgs: Array<{
    id: string;
    slug: "ffsa" | "missio";
    name: string;
  }>;
  rolesByOrg: Record<
    string,
    Array<"pastor" | "admin" | "house_church_leader" | "team_leader" | "finance">
  >;
  currentOrg: "missio" | null;
}

/**
 * Person JSON from the Missio people routes.
 * `name` is built by the route from the contact. The database row also has
 * `orgId`; the route does not send it. `joinedAt` is a date string or null.
 */
export interface MissioPerson {
  id: string;
  contactId: string;
  name: string;
  campus: MissioCampus;
  status: MissioStatus;
  joinedAt: string | null;
  currentStage: string | null;
}

/**
 * One exact contact hit from GET /api/missio/contacts/search.
 * People who are not in Missio have no full name and no contact id — only
 * `maskedName` and the opaque `matchToken` used to link them.
 * `name` and `personId` are set only when `alreadyInOrg` is true.
 */
export interface ContactMatch {
  matchToken: string;
  maskedName: string;
  maskedEmail: string | null;
  maskedPhone: string | null;
  alreadyInOrg: boolean;
  personId?: string;
  name?: string;
}

/**
 * POST /api/missio/people.
 * Either link the contact the pastor just matched, using the opaque
 * matchToken, or create a new contact. contactId is not accepted.
 * matchedBy is the email or phone they typed, unchanged.
 * The UI never sends a Missio label — a database trigger sets that.
 * A new contact needs a name and at least one of email or phone.
 * That form does not link an existing contact. If the email or phone
 * already belongs to someone, the route returns 409 code `exists_use_search`.
 * `linkedExisting` is only meaningful on the matchToken path.
 */
export type CreateMissioPersonInput =
  | {
      matchToken: string;
      matchedBy: { email: string } | { phone: string };
      campus?: MissioCampus;
      status?: MissioStatus;
      joinedAt?: string | null;
    }
  | {
      name: string;
      email?: string;
      phone?: string;
      campus?: MissioCampus;
      status?: MissioStatus;
      joinedAt?: string | null;
    };

/** PATCH /api/missio/people/[id]. No delete; inactive is the end state. */
export interface UpdateMissioPersonInput {
  campus?: MissioCampus;
  status?: MissioStatus;
  joinedAt?: string | null;
  currentStage?: string | null;
}
