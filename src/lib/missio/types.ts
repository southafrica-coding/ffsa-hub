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
  contactId: string;
  name: string;
  /** Null when the contact has no email. Never the full address. */
  maskedEmail: string | null;
  /** Null when the contact has no phone. Never the full number. */
  maskedPhone: string | null;
  alreadyInOrg: boolean;
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
