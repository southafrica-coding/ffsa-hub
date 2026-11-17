/**
 * JSON contract for /api/missio. Hub UI imports these names directly.
 * Campus codes stay as stored ('potch', 'jhb'); display names belong in the UI.
 */

export type MissioCampus = "potch" | "jhb";

export type MissioStatus = "visitor" | "active" | "inactive";

export type MissioOrgRole =
  | "pastor"
  | "admin"
  | "house_church_leader"
  | "team_leader"
  | "finance";

export type MissioPerson = {
  id: string;
  contactId: string;
  name: string;
  campus: MissioCampus;
  status: MissioStatus;
  joinedAt: string | null;
  currentStage: string | null;
};

export type MissioMe = {
  orgs: { id: string; slug: string; name: string }[];
  rolesByOrg: Record<string, MissioOrgRole[]>;
  /** 'missio' when the caller holds any Missio org role, otherwise null. */
  currentOrg: "missio" | null;
};

export type ContactMatch = {
  /** base64url(sha256(userId|contactId|normalised email or phone)). Not a contact id. */
  matchToken: string;
  /** First letter of each name part. Always present. */
  maskedName: string;
  /** Null when the contact has no email. Never the full address. */
  maskedEmail: string | null;
  /** Null when the contact has no phone. Never the full number. */
  maskedPhone: string | null;
  alreadyInOrg: boolean;
  /** org_people id. Set only when alreadyInOrg. */
  personId?: string;
  /** Full name. Set only when alreadyInOrg. */
  name?: string;
};

export type MissioPeopleResponse = {
  rows: MissioPerson[];
  total: number;
};

export type MissioContactSearchResponse = {
  matches: ContactMatch[];
};

/** Link a contact the server can re-verify, or create one from a name plus an identifier. */
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

export type CreateMissioPersonResponse = {
  person: MissioPerson;
  /** True when an existing FFSA contact was linked instead of a new row being inserted. */
  linkedExisting: boolean;
};

export type UpdateMissioPersonInput = {
  campus?: MissioCampus;
  status?: MissioStatus;
  joinedAt?: string | null;
  currentStage?: string | null;
};

/** Machine-readable code on every Missio error response. */
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
