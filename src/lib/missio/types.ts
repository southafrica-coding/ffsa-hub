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
  | "finance"
  | "coach";

export type MissioPerson = {
  id: string;
  contactId: string;
  name: string;
  campus: MissioCampus;
  status: MissioStatus;
  joinedAt: string | null;
  currentStage: string | null;
  /**
   * Current house memberships, leaders first (GET /api/missio/people only).
   * Empty when they're in no house. Absent when the read failed, so a list
   * never claims "not in a house" it couldn't check.
   */
  houses?: MissioPersonHouse[];
  /**
   * Teams they're on, from missio_team_members / missio_team_leaders
   * (GET /api/missio/people only). Absent when the roster couldn't be read,
   * so a row never claims "doesn't serve" it couldn't check.
   */
  teams?: MissioPersonTeam[];
  /** Teams they asked about on WhatsApp (status new only), not yet on the roster for. */
  interestTeams?: MissioPersonInterest[];
  /**
   * Their Missio household (GET /api/missio/people only), when they're an
   * adult in one. Absent when they're in none, or when the household read
   * failed, so a row never claims a family it couldn't check.
   */
  family?: MissioPersonFamily;
};

/**
 * A family summary on a People row. First names only, no surnames, no
 * contact details. Children's age comes from their birth year.
 */
export type MissioPersonFamily = {
  householdId: string;
  /** The other adult, when there are exactly two and neither is labelled as a relative or friend. */
  spouse?: { personId: string | null; firstName: string; label: string | null };
  /** Every other adult, when it isn't a simple couple (three or more adults, or a "mom"). */
  otherAdults?: Array<{ personId: string | null; firstName: string; label: string | null }>;
  /** Oldest first. */
  children: Array<{ firstName: string; age: number | null }>;
};

/** A team on a People row. One per team: "Leads" wins over a member row. */
export type MissioPersonTeam = { id: string; name: string; leads: boolean };

/** An open (status new) serving interest. teamId is null when it isn't a roster team. */
export type MissioPersonInterest = { name: string; teamId: string | null };

/** Funnel counts for the People list. Follow campus/status/search, not the serving filter. */
export type MissioServingCounts = {
  serves: number;
  doesnt: number;
  interested: number;
  teams: Array<{ id: string; name: string; count: number }>;
};

/** One current house membership on a People row (board M2a/M2b). */
export type MissioPersonHouse = {
  houseId: string;
  number: number;
  name: string | null;
  role: HouseChurchRole;
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
  /** Absent when the roster couldn't be read. */
  serving?: MissioServingCounts;
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
  | "conflict"
  | "not_missio_person"
  | "invalid_token"
  | "invalid_input"
  | "rate_limited"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "ended_at_in_future"
  | "membership_not_current"
  | "member_left_missio"
  | "server_error"
  | "method_not_allowed"
  | "no_login"
  | "in_other_household"
  | "household_exists"
  | "both_in_households";

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
  /** Masked email and phone, to tell apart contacts who share a name. Review queue only. */
  hint?: string;
};

/** A contact found by name from the import review queue. */
export type ReviewContactMatch = PersonRef & {
  /** True when the contact already has a Missio people row. */
  inMissio: boolean;
};

export type ReviewContactSearchResponse = {
  matches: ReviewContactMatch[];
};

export type HouseChurchMemberView = Omit<PersonRef, "displayName"> & {
  /** Null when leftMissio is true. The contact row is not read. */
  displayName: string | null;
  role: HouseChurchRole;
  startedAt: string;
  /** True for an open membership whose contact is no longer in Missio org_people. */
  leftMissio: boolean;
};

export type HouseChurchSummary = {
  id: string;
  number: number;
  name: string | null;
  campus: MissioCampus;
  meetingDay: string | null;
  location: string | null;
  memberCount: number;
  /** Children of households with an adult in this house (migration 341). Not counted in memberCount. */
  kidsCount: number;
  /** People marked ready to lead in this house (migration 342). */
  readyToLead: number;
  leaders: PersonRef[];
  coLeaders: PersonRef[];
  /** The house's coaches, longest-serving first. Empty when none (or before migration 337). */
  coaches: CoachRef[];
};

/** A coach on a house, with the day they started coaching it. */
export type CoachRef = PersonRef & { since: string | null };

/** What the signed-in user may do in house churches. Pastors: everything. */
export type HouseChurchAbilities = {
  /** Add people, set the coach, review imported names. Pastors only. */
  place: boolean;
  /** Change roles and end memberships. Pastors, and coaches in houses they coach. */
  editMembers: boolean;
};

export type HouseChurchDetail = HouseChurchSummary & {
  leaderNotes: string | null;
  members: HouseChurchMemberView[];
};

export type HouseChurchListResponse = {
  houses: HouseChurchSummary[];
  /** Same as abilities.place. Kept for older clients. */
  canWrite: boolean;
  abilities: HouseChurchAbilities;
};

export type HouseChurchDetailResponse = {
  house: HouseChurchDetail;
  canWrite: boolean;
  abilities: HouseChurchAbilities;
};

export type ImportReviewStatus = "pending" | "matched" | "new" | "skipped";

/**
 * A review row a pastor can act on. sourceLine is the sheet line number.
 * rawName is that one person's name. kind is the importer's classifier.
 * note is the parser annotation. The table column is notes, not note
 * (for example "see house 4"). The rest of the sheet line is not returned.
 */
export type ImportReviewItem = {
  id: string;
  status: ImportReviewStatus;
  sourceLine: number;
  rawName: string;
  kind: string | null;
  note: string | null;
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

export type ConnectVisitType = "first_time" | "been_a_while" | "regular";

export type FollowupStage = "new" | "contacted" | "visited_house" | "joined";

export type FollowupSource = "contact" | "connect_response";

/**
 * One row of GET /api/missio/follow-up.
 * key is c_<contactId> for a labelled Missio contact and r_<connectResponseId> for a card.
 * stage is the effective stage. People with no follow-up row yet are "new" and followupId is null.
 * phone and email follow FOLLOWUP_LIST_INCLUDES_CONTACT_PII in follow-up.ts.
 * A phone-only card that is waiting on a pastor keeps an r_ key.
 * needsConfirm is true when connect_responses.match_status is pending_confirm.
 * suggestedContact is the contact id and a display name. No phone and no email.
 * The list view does not include match_status, so the card row supplies it.
 */
export type FollowupPerson = {
  key: string;
  source: FollowupSource;
  contactId: string | null;
  connectResponseId: string | null;
  followupId: string | null;
  displayName: string;
  phone: string | null;
  email: string | null;
  visitType: ConnectVisitType | null;
  wantsHouseChurch: boolean | null;
  wantsPrayer: boolean | null;
  stage: FollowupStage;
  assignedLeader: PersonRef | null;
  submittedAt: string | null;
  needsConfirm: boolean;
  suggestedContact: { contactId: string; displayName: string } | null;
};

export type FollowupListResponse = {
  people: FollowupPerson[];
  canWrite: boolean;
};

export type FollowupTimelineKind = "submitted" | "stage_change" | "note";

export type FollowupTimelineEntry = {
  id: string;
  kind: FollowupTimelineKind;
  fromStage: FollowupStage | null;
  toStage: FollowupStage | null;
  body: string | null;
  by: { displayName: string } | null;
  at: string;
};

export type ConnectFieldErrors = {
  name?: string;
  phone?: string;
  email?: string;
  visitType?: string;
  prayerRequest?: string;
  notes?: string;
};
