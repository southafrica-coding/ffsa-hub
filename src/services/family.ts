// Family data layer — spouses, anniversaries and children.
//
// Shared facts live in ONE place: the anniversary on the `partnerships`
// row, the kids on `partnership_id`. Each user's view is derived from
// those, so two partners can never disagree.
//
// Every function takes the ADMIN (service-role) client and an explicit
// `userId`, and enforces ownership in code — mirroring the RLS in
// migration 111 but able to resolve the *other* partner's display name
// (which RLS would otherwise hide). Callers MUST authenticate first and
// pass the authenticated user's id.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type PartnerStatus =
  | "engaged"
  | "married"
  | "separated"
  | "divorced"
  | "widowed";

const STATUSES: PartnerStatus[] = [
  "engaged",
  "married",
  "separated",
  "divorced",
  "widowed",
];

// A partnership is "active" (occupies the one-relationship-at-a-time slot)
// while it is pending/confirmed and not yet ended.
const ACTIVE_STATUSES: PartnerStatus[] = ["engaged", "married", "separated"];

export type FamilyChild = {
  id: string;
  full_name: string;
  birth_date: string | null;
  notes: string | null;
  shared: boolean; // true once attached to the couple
};

export type FamilyPartnership = {
  id: string;
  status: PartnerStatus;
  anniversary_date: string | null;
  partnerName: string; // resolved display name (linked user or free-text)
  partnerIsUser: boolean;
  confirmation_status: "pending" | "confirmed" | "declined";
  isInitiator: boolean; // current user is partner A
};

export type IncomingLinkRequest = {
  id: string;
  fromName: string;
  fromUserId: string;
  anniversary_date: string | null;
  status: PartnerStatus;
  created_at: string;
};

export type FamilySnapshot = {
  partnership: FamilyPartnership | null; // confirmed / active couple
  outgoingPending: FamilyPartnership | null; // request the user sent, awaiting confirm
  incomingRequests: IncomingLinkRequest[]; // someone listed the user as their spouse
  children: FamilyChild[];
};

export type LinkableUser = {
  id: string;
  name: string;
  hint: string; // masked email, to disambiguate same-named people
};

export type FamilyMilestone = {
  kind: "anniversary" | "birthday";
  refId: string; // partnership id or child id
  title: string;
  dateISO: string; // next occurrence (YYYY-MM-DD)
  inDays: number;
  years: number; // anniversary years / child's upcoming age
};

// ── helpers ────────────────────────────────────────────────

type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

function displayName(u: Partial<UserRow> | null | undefined): string {
  if (!u) return "Unknown";
  const name = [u.preferred_name ?? u.first_name, u.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || u.email || "Unknown";
}

function maskEmail(email?: string | null): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return "";
  return `${local.slice(0, 1)}•••@${domain}`;
}

async function namesByIds(
  admin: Client,
  ids: string[]
): Promise<Map<string, UserRow>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name, email")
    .in("id", unique);
  const map = new Map<string, UserRow>();
  for (const u of (data ?? []) as UserRow[]) map.set(u.id, u);
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PartnershipRow = any;

function involvesUser(p: PartnershipRow, userId: string): boolean {
  return p.partner_a_user_id === userId || p.partner_b_user_id === userId;
}

function isActive(p: PartnershipRow): boolean {
  return (
    p.confirmation_status !== "declined" &&
    ACTIVE_STATUSES.includes(p.status as PartnerStatus)
  );
}

// "today" in SA time, as date parts (the date columns are tz-naive).
function saTodayParts(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// Next yearly occurrence of a month/day from a YYYY-MM-DD source date.
function nextAnnual(
  sourceISO: string,
  today: { y: number; m: number; d: number }
): { iso: string; inDays: number; years: number } {
  const [sy, sm, sd] = sourceISO.slice(0, 10).split("-").map(Number);
  const todayUTC = Date.UTC(today.y, today.m - 1, today.d);
  let year = today.y;
  if (Date.UTC(year, sm - 1, sd) < todayUTC) year += 1;
  const occUTC = Date.UTC(year, sm - 1, sd);
  const inDays = Math.round((occUTC - todayUTC) / 86_400_000);
  return {
    iso: `${year}-${String(sm).padStart(2, "0")}-${String(sd).padStart(2, "0")}`,
    inDays,
    years: year - sy,
  };
}

// ── reads ──────────────────────────────────────────────────

async function loadPartnerships(
  admin: Client,
  userId: string
): Promise<PartnershipRow[]> {
  const { data } = await admin
    .from("partnerships")
    .select("*")
    .or(`partner_a_user_id.eq.${userId},partner_b_user_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  return (data ?? []) as PartnershipRow[];
}

function toPartnership(
  p: PartnershipRow,
  userId: string,
  names: Map<string, UserRow>
): FamilyPartnership {
  const isInitiator = p.partner_a_user_id === userId;
  const otherUserId = isInitiator ? p.partner_b_user_id : p.partner_a_user_id;
  const partnerName = otherUserId
    ? displayName(names.get(otherUserId))
    : (p.partner_b_name ?? "Partner");
  return {
    id: p.id,
    status: p.status,
    anniversary_date: p.anniversary_date,
    partnerName,
    partnerIsUser: !!otherUserId,
    confirmation_status: p.confirmation_status,
    isInitiator,
  };
}

export async function getMyFamily(
  admin: Client,
  userId: string
): Promise<FamilySnapshot> {
  const rows = await loadPartnerships(admin, userId);

  // Resolve the names of every linked user across all rows in one query.
  const otherIds = rows.flatMap((p) =>
    [p.partner_a_user_id, p.partner_b_user_id].filter(
      (id) => id && id !== userId
    )
  );
  const names = await namesByIds(admin, otherIds as string[]);

  let partnership: FamilyPartnership | null = null;
  let outgoingPending: FamilyPartnership | null = null;
  const incomingRequests: IncomingLinkRequest[] = [];

  for (const p of rows) {
    if (
      p.partner_b_user_id === userId &&
      p.confirmation_status === "pending"
    ) {
      incomingRequests.push({
        id: p.id,
        fromUserId: p.partner_a_user_id,
        fromName: displayName(names.get(p.partner_a_user_id)),
        anniversary_date: p.anniversary_date,
        status: p.status,
        created_at: p.created_at,
      });
      continue;
    }
    if (
      p.partner_a_user_id === userId &&
      p.confirmation_status === "pending"
    ) {
      if (!outgoingPending) outgoingPending = toPartnership(p, userId, names);
      continue;
    }
    // First confirmed, non-ended row wins as the current partnership.
    if (!partnership && p.confirmation_status === "confirmed") {
      partnership = toPartnership(p, userId, names);
    }
  }

  // Children: owned by the user, or shared on the user's partnership rows.
  const partnershipIds = rows.map((p) => p.id);
  const orParts = [`owner_user_id.eq.${userId}`];
  if (partnershipIds.length > 0) {
    orParts.push(`partnership_id.in.(${partnershipIds.join(",")})`);
  }
  const { data: kidRows } = await admin
    .from("children")
    .select("*")
    .or(orParts.join(","))
    .order("birth_date", { ascending: true, nullsFirst: false });

  const seen = new Set<string>();
  const children: FamilyChild[] = [];
  for (const c of (kidRows ?? []) as PartnershipRow[]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    children.push({
      id: c.id,
      full_name: c.full_name,
      birth_date: c.birth_date,
      notes: c.notes,
      shared: !!c.partnership_id,
    });
  }

  return { partnership, outgoingPending, incomingRequests, children };
}

export async function searchLinkableUsers(
  admin: Client,
  userId: string,
  query: string
): Promise<LinkableUser[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const { data } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name, email")
    .or(
      [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `preferred_name.ilike.${like}`,
        `email.ilike.${like}`,
      ].join(",")
    )
    .neq("id", userId)
    .limit(8);
  return ((data ?? []) as UserRow[]).map((u) => ({
    id: u.id,
    name: displayName(u),
    hint: maskEmail(u.email),
  }));
}

// ── writes ─────────────────────────────────────────────────

export class FamilyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// True if the user already occupies their one active-relationship slot
// (pending request out/in, or a confirmed non-ended partnership).
async function hasActiveLink(admin: Client, userId: string): Promise<boolean> {
  const rows = await loadPartnerships(admin, userId);
  return rows.some(
    (p) =>
      involvesUser(p, userId) &&
      (p.confirmation_status === "pending" || isActive(p)) &&
      p.confirmation_status !== "declined"
  );
}

export async function createPartnership(
  admin: Client,
  userId: string,
  input: {
    partnerUserId?: string | null;
    partnerName?: string | null;
    anniversaryDate?: string | null;
    status?: PartnerStatus;
  }
): Promise<{ id: string }> {
  const partnerUserId = input.partnerUserId?.trim() || null;
  const partnerName = input.partnerName?.trim() || null;

  if (!!partnerUserId === !!partnerName) {
    throw new FamilyError(
      "Provide either a Hub user to link OR a spouse's name — not both."
    );
  }
  if (partnerUserId === userId) {
    throw new FamilyError("You can't link yourself as your own spouse.");
  }
  const status: PartnerStatus = STATUSES.includes(input.status as PartnerStatus)
    ? (input.status as PartnerStatus)
    : "married";

  if (await hasActiveLink(admin, userId)) {
    throw new FamilyError(
      "You already have a partner linked or a pending request. Resolve that first."
    );
  }
  if (partnerUserId && (await hasActiveLink(admin, partnerUserId))) {
    throw new FamilyError(
      "That person is already linked to a partner or has a pending request."
    );
  }

  const linkedUser = !!partnerUserId;
  const { data, error } = await admin
    .from("partnerships")
    .insert({
      partner_a_user_id: userId,
      partner_b_user_id: partnerUserId,
      partner_b_name: partnerName,
      anniversary_date: input.anniversaryDate || null,
      status,
      // a real Hub user must confirm; a non-user spouse is confirmed at once
      confirmation_status: linkedUser ? "pending" : "confirmed",
      confirmed_at: linkedUser ? null : new Date().toISOString(),
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new FamilyError(error?.message ?? "Could not create the link.", 500);
  }

  // Non-user spouse is live immediately → pull the initiator's solo kids
  // onto the couple so they read as "shared".
  if (!linkedUser) await reparentSoloChildren(admin, userId, data.id);

  return { id: data.id };
}

export async function confirmPartnership(
  admin: Client,
  userId: string,
  partnershipId: string,
  accept: boolean
): Promise<void> {
  const { data: p } = await admin
    .from("partnerships")
    .select("*")
    .eq("id", partnershipId)
    .single();

  if (!p) throw new FamilyError("Link request not found.", 404);
  if (p.partner_b_user_id !== userId || p.confirmation_status !== "pending") {
    throw new FamilyError("This request isn't yours to confirm.", 403);
  }

  if (!accept) {
    const { error } = await admin
      .from("partnerships")
      .update({ confirmation_status: "declined" })
      .eq("id", partnershipId);
    if (error) throw new FamilyError(error.message, 500);
    return;
  }

  // Race guard: make sure neither side picked up another active link while
  // this one sat pending.
  if (await hasOtherActiveLink(admin, p.partner_a_user_id, partnershipId)) {
    throw new FamilyError(
      "The person who sent this request has since linked someone else."
    );
  }
  if (await hasOtherActiveLink(admin, userId, partnershipId)) {
    throw new FamilyError("You're already linked to a partner.");
  }

  const { error } = await admin
    .from("partnerships")
    .update({
      confirmation_status: "confirmed",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", partnershipId);
  if (error) throw new FamilyError(error.message, 500);

  // Both partners should now see the same kids — pull the initiator's solo
  // children onto the couple.
  await reparentSoloChildren(admin, p.partner_a_user_id, partnershipId);
}

async function hasOtherActiveLink(
  admin: Client,
  userId: string,
  exceptId: string
): Promise<boolean> {
  const rows = await loadPartnerships(admin, userId);
  return rows.some(
    (p) => p.id !== exceptId && involvesUser(p, userId) && isActive(p)
  );
}

export async function updatePartnership(
  admin: Client,
  userId: string,
  partnershipId: string,
  patch: {
    anniversaryDate?: string | null;
    status?: PartnerStatus;
    partnerName?: string | null;
  }
): Promise<void> {
  const { data: p } = await admin
    .from("partnerships")
    .select("*")
    .eq("id", partnershipId)
    .single();
  if (!p) throw new FamilyError("Partnership not found.", 404);
  if (!involvesUser(p, userId)) {
    throw new FamilyError("This isn't your partnership.", 403);
  }

  const update: Record<string, unknown> = {};
  if ("anniversaryDate" in patch) {
    update.anniversary_date = patch.anniversaryDate || null;
  }
  if (patch.status) {
    if (!STATUSES.includes(patch.status)) {
      throw new FamilyError("Unknown relationship status.");
    }
    update.status = patch.status;
  }
  // Only a non-user spouse's name is editable here.
  if ("partnerName" in patch && !p.partner_b_user_id) {
    const name = patch.partnerName?.trim();
    if (!name) throw new FamilyError("A spouse name is required.");
    update.partner_b_name = name;
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await admin
    .from("partnerships")
    .update(update)
    .eq("id", partnershipId);
  if (error) throw new FamilyError(error.message, 500);
}

export async function deletePartnership(
  admin: Client,
  userId: string,
  partnershipId: string
): Promise<void> {
  const { data: p } = await admin
    .from("partnerships")
    .select("*")
    .eq("id", partnershipId)
    .single();
  if (!p) throw new FamilyError("Partnership not found.", 404);
  if (!involvesUser(p, userId)) {
    throw new FamilyError("This isn't your partnership.", 403);
  }

  // Preserve the kids: re-home any shared children to the initiator as a
  // solo owner before the row goes away (ON DELETE SET NULL would otherwise
  // leave them parentless and trip the CHECK constraint).
  await admin
    .from("children")
    .update({ partnership_id: null, owner_user_id: p.partner_a_user_id })
    .eq("partnership_id", partnershipId);

  const { error } = await admin
    .from("partnerships")
    .delete()
    .eq("id", partnershipId);
  if (error) throw new FamilyError(error.message, 500);
}

// Pull a user's solo (un-partnered) children onto a partnership.
async function reparentSoloChildren(
  admin: Client,
  userId: string,
  partnershipId: string
): Promise<void> {
  await admin
    .from("children")
    .update({ partnership_id: partnershipId })
    .eq("owner_user_id", userId)
    .is("partnership_id", null);
}

async function activePartnershipId(
  admin: Client,
  userId: string
): Promise<string | null> {
  const rows = await loadPartnerships(admin, userId);
  const active = rows.find(
    (p) => involvesUser(p, userId) && p.confirmation_status === "confirmed" && isActive(p)
  );
  return active?.id ?? null;
}

export async function addChild(
  admin: Client,
  userId: string,
  input: { fullName: string; birthDate?: string | null; notes?: string | null }
): Promise<{ id: string }> {
  const fullName = input.fullName?.trim();
  if (!fullName) throw new FamilyError("A child's name is required.");

  // Attach to the couple when one exists, so both partners share the child.
  const partnershipId = await activePartnershipId(admin, userId);

  const { data, error } = await admin
    .from("children")
    .insert({
      partnership_id: partnershipId,
      owner_user_id: userId,
      full_name: fullName,
      birth_date: input.birthDate || null,
      notes: input.notes?.trim() || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new FamilyError(error?.message ?? "Could not add the child.", 500);
  }
  return { id: data.id };
}

async function loadChildForUser(
  admin: Client,
  userId: string,
  childId: string
): Promise<PartnershipRow> {
  const { data: c } = await admin
    .from("children")
    .select("*")
    .eq("id", childId)
    .single();
  if (!c) throw new FamilyError("Child not found.", 404);

  let allowed = c.owner_user_id === userId;
  if (!allowed && c.partnership_id) {
    const { data: p } = await admin
      .from("partnerships")
      .select("partner_a_user_id, partner_b_user_id")
      .eq("id", c.partnership_id)
      .single();
    allowed = !!p && involvesUser(p, userId);
  }
  if (!allowed) throw new FamilyError("This isn't your record.", 403);
  return c;
}

export async function updateChild(
  admin: Client,
  userId: string,
  childId: string,
  patch: { fullName?: string; birthDate?: string | null; notes?: string | null }
): Promise<void> {
  await loadChildForUser(admin, userId, childId);

  const update: Record<string, unknown> = {};
  if (patch.fullName !== undefined) {
    const name = patch.fullName.trim();
    if (!name) throw new FamilyError("A child's name is required.");
    update.full_name = name;
  }
  if ("birthDate" in patch) update.birth_date = patch.birthDate || null;
  if ("notes" in patch) update.notes = patch.notes?.trim() || null;
  if (Object.keys(update).length === 0) return;

  const { error } = await admin
    .from("children")
    .update(update)
    .eq("id", childId);
  if (error) throw new FamilyError(error.message, 500);
}

export async function removeChild(
  admin: Client,
  userId: string,
  childId: string
): Promise<void> {
  await loadChildForUser(admin, userId, childId);
  const { error } = await admin.from("children").delete().eq("id", childId);
  if (error) throw new FamilyError(error.message, 500);
}

// ── milestones (feed + calendar) ───────────────────────────

export async function getUpcomingFamilyMilestones(
  admin: Client,
  userId: string,
  withinDays = 60
): Promise<FamilyMilestone[]> {
  const snap = await getMyFamily(admin, userId);
  const today = saTodayParts();
  const out: FamilyMilestone[] = [];

  const couple = snap.partnership;
  if (couple?.anniversary_date) {
    const n = nextAnnual(couple.anniversary_date, today);
    if (n.inDays <= withinDays) {
      out.push({
        kind: "anniversary",
        refId: couple.id,
        title: `Anniversary · ${couple.partnerName}`,
        dateISO: n.iso,
        inDays: n.inDays,
        years: n.years,
      });
    }
  }

  for (const c of snap.children) {
    if (!c.birth_date) continue;
    const n = nextAnnual(c.birth_date, today);
    if (n.inDays <= withinDays) {
      out.push({
        kind: "birthday",
        refId: c.id,
        title: `${c.full_name}'s birthday`,
        dateISO: n.iso,
        inDays: n.inDays,
        years: n.years,
      });
    }
  }

  return out.sort((a, b) => a.inDays - b.inDays);
}
