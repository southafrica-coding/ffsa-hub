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
  | "already_member"
  | "already_resolved"
  | "not_missio_person"
  | "invalid_token"
  | "invalid_input"
  | "rate_limited"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "ended_at_in_future"
  | "server_error"
  | "method_not_allowed";

export type HouseChurchRole = "leader" | "co_leader" | "member";

/**
 * A contact as a house-church screen may show them.
 * displayName is the preferred name when there is one, otherwise the first name, plus the last name.
 * orgPersonId is set only when this contact has an org_people row in Missio.
 * House membership is not a status on that row: a member is someone with an active house_church_members row.
 */
export type PersonRef = {
  contactId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  orgPersonId?: string;
};

export type HouseChurchMemberView = PersonRef & {
  role: HouseChurchRole;
  startedAt: string;
};

export type HouseChurchSummary = {
  id: string;
  number: number;
  name: string | null;
  campus: MissioCampus;
  meetingDay: string | null;
  location: string | null;
  memberCount: number;
  leaders: PersonRef[];
  coLeaders: PersonRef[];
};

export type HouseChurchDetail = HouseChurchSummary & {
  leaderNotes: string | null;
  members: HouseChurchMemberView[];
};

export type HouseChurchListResponse = {
  houses: HouseChurchSummary[];
  canWrite: true;
};

export type HouseChurchDetailResponse = {
  house: HouseChurchDetail;
  canWrite: true;
};

export type ImportReviewStatus = "pending" | "matched" | "new" | "skipped";

/**
 * A review row a pastor can act on. sourceLine is the sheet line number.
 * rawName is that one person's name. The rest of the sheet line (notes,
 * other names, the raw CSV) is not returned.
 */
export type ImportReviewItem = {
  id: string;
  status: ImportReviewStatus;
  sourceLine: number;
  rawName: string;
  matchType: string | null;
  houseNumber: number;
  house: { id: string; number: number; name: string | null } | null;
  role: HouseChurchRole;
  candidates: PersonRef[];
};

export type ImportReviewListResponse = {
  items: ImportReviewItem[];
};

export type ResolveImportReviewResponse = {
  item: ImportReviewItem;
  member?: HouseChurchMemberView;
};
