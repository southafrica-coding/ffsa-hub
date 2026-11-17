// TODO: Hub Backend owns src/lib/missio/types.ts. Do not add that file on
// this branch. The exports below match the contract Backend will publish
// (MissioMe, MissioPerson, MissioCampus, MissioStatus, ContactMatch,
// CreateMissioPersonInput, UpdateMissioPersonInput). When that module
// merges, switch these imports over to it and delete this shim.

/** Campus stored on a Missio person. Potch is the main church. */
export type MissioCampus = "potch" | "jhb";

/** Visitor, active, or inactive. Inactive is the end state — there is no delete. */
export type MissioStatus = "visitor" | "active" | "inactive";

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

/** One exact contact hit. Email and phone are already masked by the route. */
export interface ContactMatch {
  contactId: string;
  name: string;
  maskedEmail: string | null;
  maskedPhone: string | null;
  alreadyInOrg: boolean;
}

/**
 * POST /api/missio/people.
 * Either link a contact the user just matched, or create a new contact.
 * The UI never sends a Missio label — a database trigger sets that.
 * A new contact needs a name and at least one of email or phone.
 */
export type CreateMissioPersonInput =
  | {
      contactId: string;
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
