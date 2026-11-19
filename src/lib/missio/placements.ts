import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgAccess } from "@/lib/missio/access";
import { requireAvailabilityTokenSecret } from "@/lib/missio/availability/token";
import { houseInScope, type HouseScope } from "@/lib/missio/house-churches";
import { joburgDate } from "@/lib/missio/feedback";

/**
 * Placements (boards M12a–c). Migration 340.
 *
 * A pastor places someone in a house. Four steps follow: placed, leader
 * said hi, first visit, joined. Joined adds the house membership, which
 * closes their follow-up (332's trigger). The person and the leader each
 * get a link with no login; the raw links are an HMAC of the placement id
 * and a stored nonce (Missio link secret, "place-person" / "place-leader"
 * prefixes), so a pastor can copy them again. Only hashes are looked up.
 */

export type PlacementStep = "placed" | "said_hi" | "first_visit" | "joined";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PlacementView = {
  id: string;
  person: { contactId: string; name: string; phone: string | null };
  house: { id: string; number: number; name: string | null; meetingDay: string | null; location: string | null };
  leaders: Array<{ name: string; phone: string | null }>;
  placedAt: string;
  leaderDeadline: string;
  saidHiAt: string | null;
  firstVisitAt: string | null;
  joinedAt: string | null;
  cancelledAt: string | null;
  cantMakeItAt: string | null;
  /** The step that is waiting, or null once joined or cancelled. */
  next: Exclude<PlacementStep, "placed"> | null;
  /** The leader hasn't said hi and the deadline has passed. */
  overdue: boolean;
  /** Paths for the two no-login pages. Pastors only. */
  links?: { person: string; leader: string };
};

type Fail = { ok: false; status: number; code: string; error: string };
const fail = (status: number, code: string, error: string): Fail => ({ ok: false, status, code, error });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const ROW_COLUMNS =
  "id, contact_id, house_church_id, placed_at, leader_deadline, leader_said_hi_at, first_visit_at, joined_at, cancelled_at, cant_make_it_at";

type Row = {
  id: string;
  contact_id: string;
  house_church_id: string;
  placed_at: string;
  leader_deadline: string;
  leader_said_hi_at: string | null;
  first_visit_at: string | null;
  joined_at: string | null;
  cancelled_at: string | null;
  cant_make_it_at: string | null;
  person_nonce?: string;
  leader_nonce?: string;
};

export function placementAdmin(): Db {
  return createAdminClient();
}

const hash = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

function derive(kind: "person" | "leader", id: string, nonce: string): string {
  return createHmac("sha256", requireAvailabilityTokenSecret()).update(`place-${kind}|${id}|${nonce}`).digest("base64url");
}

export const personPath = (raw: string) => `/serve/missio/w/${raw}`;
export const leaderPath = (raw: string) => `/serve/missio/l/${raw}`;

function nextStep(row: Row): PlacementView["next"] {
  if (row.joined_at || row.cancelled_at) return null;
  if (!row.leader_said_hi_at) return "said_hi";
  if (!row.first_visit_at) return "first_visit";
  return "joined";
}

function deadline(now = new Date()): string {
  const date = new Date(`${joburgDate(now)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 3);
  return date.toISOString().slice(0, 10);
}

function nameOf(row: { first_name?: string | null; last_name?: string | null; preferred_name?: string | null } | undefined): string {
  if (!row) return "";
  return [row.preferred_name || row.first_name, row.last_name].filter(Boolean).join(" ").trim();
}

/** Names, phones, houses and leaders for a set of placement rows. Service role, after the caller's check. */
async function shape(db: Db, rows: Row[], withPhones: boolean, now = new Date()): Promise<PlacementView[]> {
  if (rows.length === 0) return [];
  const houseIds = [...new Set(rows.map((row) => row.house_church_id))];
  const [houses, leaders] = await Promise.all([
    db.from("house_churches").select("id, number, name, meeting_day, location").in("id", houseIds),
    db
      .from("house_church_members")
      .select("house_church_id, contact_id, role, started_at")
      .in("house_church_id", houseIds)
      .in("role", ["leader", "co_leader"])
      .is("ended_at", null),
  ]);
  const leaderRows = (leaders.data ?? []) as Array<{ house_church_id: string; contact_id: string; role: string }>;
  const contactIds = [...new Set([...rows.map((row) => row.contact_id), ...leaderRows.map((row) => row.contact_id)])];
  const contacts = await db.from("contacts").select("id, first_name, last_name, preferred_name, phone").in("id", contactIds);
  const byContact = new Map<string, { first_name: string | null; last_name: string | null; preferred_name: string | null; phone: string | null }>(
    ((contacts.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; phone: string | null }>).map((row) => [row.id, row])
  );
  const byHouse = new Map<string, { id: string; number: number; name: string | null; meeting_day: string | null; location: string | null }>(
    ((houses.data ?? []) as Array<{ id: string; number: number; name: string | null; meeting_day: string | null; location: string | null }>).map((row) => [row.id, row])
  );
  const today = joburgDate(now);
  return rows.map((row) => {
    const house = byHouse.get(row.house_church_id);
    const person = byContact.get(row.contact_id);
    const leading = leaderRows
      .filter((leader) => leader.house_church_id === row.house_church_id)
      .sort((a, b) => (a.role === b.role ? 0 : a.role === "leader" ? -1 : 1))
      .map((leader) => {
        const contact = byContact.get(leader.contact_id);
        return { name: nameOf(contact ?? undefined), phone: withPhones ? contact?.phone?.trim() || null : null };
      });
    return {
      id: row.id,
      person: { contactId: row.contact_id, name: nameOf(person ?? undefined), phone: withPhones ? person?.phone?.trim() || null : null },
      house: {
        id: row.house_church_id,
        number: Number(house?.number ?? 0),
        name: house?.name ?? null,
        meetingDay: house?.meeting_day ?? null,
        location: house?.location ?? null,
      },
      leaders: leading,
      placedAt: row.placed_at,
      leaderDeadline: row.leader_deadline,
      saidHiAt: row.leader_said_hi_at,
      firstVisitAt: row.first_visit_at,
      joinedAt: row.joined_at,
      cancelledAt: row.cancelled_at,
      cantMakeItAt: row.cant_make_it_at,
      next: nextStep(row),
      overdue: !row.leader_said_hi_at && !row.joined_at && !row.cancelled_at && row.leader_deadline < today,
    };
  });
}

function withLinks(view: PlacementView, row: Row): PlacementView {
  if (!row.person_nonce || !row.leader_nonce) return view;
  return {
    ...view,
    links: { person: personPath(derive("person", row.id, row.person_nonce)), leader: leaderPath(derive("leader", row.id, row.leader_nonce)) },
  };
}

async function audit(db: Db, userId: string | null, action: string, id: string, changes: Record<string, unknown>) {
  const logged = await db.from("audit_logs").insert({
    user_id: userId,
    action,
    resource_type: "missio_placement",
    resource_id: id,
    changes,
    created_at: new Date().toISOString(),
  });
  if (logged.error) console.error("[missio] audit failed", logged.error.message ?? "insert failed");
}

const createSchema = z
  .object({ contactId: z.string().uuid(), houseId: z.string().uuid(), household: z.boolean().optional() })
  .strict();

type HouseRef = { id: string; campus: string | null };

/** One adult into one house: org_people, close any other open placement, insert with fresh links. */
async function placeOne(auth: OrgAccess, db: Db, house: HouseRef, contactId: string, now: Date): Promise<Row | Fail | "member"> {
  const member = await db
    .from("house_church_members")
    .select("id")
    .eq("house_church_id", house.id)
    .eq("contact_id", contactId)
    .is("ended_at", null)
    .limit(1);
  if (member.error) return fail(500, "server_error", "Something went wrong.");
  if ((member.data ?? []).length > 0) return "member";

  // A placed person must be a Missio person, so joining can add the membership.
  const inOrg = await db.from("org_people").select("id").eq("org_id", auth.orgId).eq("contact_id", contactId).maybeSingle();
  if (inOrg.error) return fail(500, "server_error", "Something went wrong.");
  if (!inOrg.data) {
    const added = await db
      .from("org_people")
      .insert({ org_id: auth.orgId, contact_id: contactId, campus: house.campus ?? "potch", status: "active", created_by: auth.user.id });
    if (added.error && added.error.code !== "23505") return fail(500, "server_error", "Something went wrong.");
  }

  const open = await db.from("missio_placements").select("id").eq("contact_id", contactId).is("joined_at", null).is("cancelled_at", null);
  if (open.error) return fail(500, "server_error", "Something went wrong.");
  for (const row of (open.data ?? []) as Array<{ id: string }>) {
    await db.from("missio_placements").update({ cancelled_at: now.toISOString() }).eq("id", row.id);
  }

  const id = crypto.randomUUID();
  const personNonce = randomBytes(32).toString("base64url");
  const leaderNonce = randomBytes(32).toString("base64url");
  const inserted = await db
    .from("missio_placements")
    .insert({
      id,
      contact_id: contactId,
      house_church_id: house.id,
      placed_by: auth.user.id,
      placed_at: now.toISOString(),
      leader_deadline: deadline(now),
      person_nonce: personNonce,
      person_token_hash: hash(derive("person", id, personNonce)),
      leader_nonce: leaderNonce,
      leader_token_hash: hash(derive("leader", id, leaderNonce)),
    })
    .select(`${ROW_COLUMNS}, person_nonce, leader_nonce`)
    .single();
  if (inserted.error || !inserted.data) {
    console.error("[missio] placement insert failed", inserted.error?.message ?? "no row");
    return fail(500, "server_error", "Something went wrong.");
  }
  await audit(db, auth.user.id, "missio.placement_created", id, { houseId: house.id, contactId });
  return inserted.data as Row;
}

/** The other adults in this contact's household (migration 341), and how many children. Empty before 341. */
async function householdOf(db: Db, contactId: string): Promise<{ others: string[]; kids: number } | null> {
  const mine = await db.from("missio_household_members").select("household_id").eq("contact_id", contactId).maybeSingle();
  if (mine.error || !mine.data) return null;
  const rows = await db.from("missio_household_members").select("kind, contact_id").eq("household_id", (mine.data as { household_id: string }).household_id);
  if (rows.error) return null;
  const list = (rows.data ?? []) as Array<{ kind: string; contact_id: string | null }>;
  return {
    others: list.filter((row) => row.kind === "adult" && row.contact_id && row.contact_id !== contactId).map((row) => row.contact_id!),
    kids: list.filter((row) => row.kind === "child").length,
  };
}

/**
 * Pastors: place someone in a house. An open placement elsewhere is
 * cancelled (they moved). With household: true, the other adults in their
 * household are placed too (board M14a); children come with them.
 */
export async function createPlacement(
  auth: OrgAccess,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; placement: PlacementView; family: { placed: number; kids: number } | null } | Fail> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const { contactId, houseId } = parsed.data;
  const house = await auth.supabase.from("house_churches").select("id, campus").eq("id", houseId).eq("org_id", auth.orgId).maybeSingle();
  if (house.error) return fail(500, "server_error", "Something went wrong.");
  if (!house.data) return fail(404, "not_found", "House not found.");
  const db = placementAdmin();

  const contact = await db.from("contacts").select("id").eq("id", contactId).maybeSingle();
  if (contact.error) return fail(500, "server_error", "Something went wrong.");
  if (!contact.data) return fail(404, "not_found", "Person not found.");

  let secretOk = true;
  try {
    requireAvailabilityTokenSecret();
  } catch {
    secretOk = false;
  }
  if (!secretOk) {
    console.error("[missio] placement link secret missing");
    return fail(500, "server_error", "Something went wrong.");
  }

  const ref = house.data as HouseRef;
  const first = await placeOne(auth, db, ref, contactId, now);
  if (first === "member") return fail(409, "already_member", "They’re already in this house.");
  if ("ok" in first) return first as Fail;

  let family: { placed: number; kids: number } | null = null;
  if (parsed.data.household) {
    const household = await householdOf(db, contactId);
    if (household) {
      let placed = 1;
      for (const other of household.others) {
        const result = await placeOne(auth, db, ref, other, now);
        if (result !== "member" && !("ok" in result)) placed += 1;
      }
      family = { placed, kids: household.kids };
    }
  }

  const [view] = await shape(db, [first], true, now);
  return { ok: true, placement: withLinks(view!, first), family };
}

/**
 * Placements this user may see: everything still open, plus what joined or
 * was cancelled in the last six weeks. Read with the user's client (RLS 340),
 * then shaped with the service role. Phones and links for pastors only.
 */
export async function listPlacements(
  auth: OrgAccess,
  scope: HouseScope,
  pastor: boolean,
  now = new Date()
): Promise<{ ok: true; placements: PlacementView[] } | Fail> {
  const since = new Date(now.getTime() - 42 * 24 * 3600 * 1000).toISOString();
  const read = await auth.supabase.from("missio_placements").select(ROW_COLUMNS).gte("placed_at", since).order("placed_at", { ascending: false });
  if (read.error) {
    if (read.error.code === "42P01" || read.error.code === "PGRST205") return { ok: true, placements: [] };
    console.error("[missio] placement list failed", read.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const openOlder = await auth.supabase
    .from("missio_placements")
    .select(ROW_COLUMNS)
    .lt("placed_at", since)
    .is("joined_at", null)
    .is("cancelled_at", null);
  const rows = [...((read.data ?? []) as Row[]), ...((openOlder.data ?? []) as Row[])].filter((row) => houseInScope(scope, row.house_church_id));
  const db = placementAdmin();
  let nonces = new Map<string, { person_nonce: string; leader_nonce: string }>();
  if (pastor && rows.length > 0) {
    const found = await db.from("missio_placements").select("id, person_nonce, leader_nonce").in("id", rows.map((row) => row.id));
    nonces = new Map(((found.data ?? []) as Array<{ id: string; person_nonce: string; leader_nonce: string }>).map((row) => [row.id, row]));
  }
  const views = await shape(db, rows, pastor, now);
  return {
    ok: true,
    placements: views.map((view) => {
      const extra = nonces.get(view.id);
      return extra ? withLinks(view, { ...(rows.find((row) => row.id === view.id) as Row), ...extra }) : view;
    }),
  };
}

/** Add the membership (role member) if they're not in the house yet. 332 then closes their follow-up. */
async function join(db: Db, row: Row, now: Date): Promise<Fail | null> {
  const current = await db
    .from("house_church_members")
    .select("id")
    .eq("house_church_id", row.house_church_id)
    .eq("contact_id", row.contact_id)
    .is("ended_at", null)
    .limit(1);
  if (current.error) return fail(500, "server_error", "Something went wrong.");
  if ((current.data ?? []).length === 0) {
    const added = await db
      .from("house_church_members")
      .insert({ house_church_id: row.house_church_id, contact_id: row.contact_id, role: "member", started_at: joburgDate(now) });
    if (added.error && added.error.code !== "23505") {
      console.error("[missio] placement join failed", added.error.message);
      return fail(500, "server_error", "Something went wrong.");
    }
  }
  return null;
}

type StepName = "said_hi" | "first_visit" | "joined" | "cancel";

async function applyStep(db: Db, row: Row, step: StepName, userId: string | null, now: Date): Promise<Fail | null> {
  if (row.joined_at || row.cancelled_at) return fail(409, "already_resolved", "This placement is already closed.");
  const at = now.toISOString();
  const patch: Record<string, string> = {};
  if (step === "cancel") patch.cancelled_at = at;
  if (step === "said_hi" || step === "first_visit" || step === "joined") patch.leader_said_hi_at = row.leader_said_hi_at ?? at;
  if (step === "first_visit" || step === "joined") patch.first_visit_at = row.first_visit_at ?? at;
  if (step === "joined") {
    const joined = await join(db, row, now);
    if (joined) return joined;
    patch.joined_at = at;
  }
  const updated = await db.from("missio_placements").update(patch).eq("id", row.id).is("joined_at", null).is("cancelled_at", null);
  if (updated.error) return fail(500, "server_error", "Something went wrong.");
  await audit(db, userId, `missio.placement_${step}`, row.id, {});
  return null;
}

const stepSchema = z.object({ step: z.enum(["said_hi", "first_visit", "joined", "cancel"]) }).strict();

/** Pastors anywhere; coaches in houses they coach. */
export async function stepPlacement(
  auth: OrgAccess,
  editScope: HouseScope,
  id: string,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; placement: PlacementView } | Fail> {
  const parsed = stepSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const read = await auth.supabase.from("missio_placements").select(ROW_COLUMNS).eq("id", id).maybeSingle();
  if (read.error) return fail(500, "server_error", "Something went wrong.");
  const row = read.data as Row | null;
  if (!row || !houseInScope(editScope, row.house_church_id)) return fail(404, "not_found", "Placement not found.");
  const db = placementAdmin();
  const failed = await applyStep(db, row, parsed.data.step, auth.user.id, now);
  if (failed) return failed;
  const fresh = await db.from("missio_placements").select(`${ROW_COLUMNS}, person_nonce, leader_nonce`).eq("id", id).single();
  const [view] = await shape(db, [fresh.data as Row], true, now);
  return { ok: true, placement: withLinks(view!, fresh.data as Row) };
}

async function byToken(db: Db, kind: "person" | "leader", raw: string): Promise<{ ok: true; row: Row } | Fail> {
  if (!TOKEN_PATTERN.test(raw)) return fail(404, "invalid_token", "This link isn’t right.");
  const column = kind === "person" ? "person_token_hash" : "leader_token_hash";
  const found = await db.from("missio_placements").select(ROW_COLUMNS).eq(column, hash(raw)).maybeSingle();
  if (found.error) return fail(500, "server_error", "Something went wrong.");
  if (!found.data) return fail(404, "invalid_token", "This link isn’t right.");
  return { ok: true, row: found.data as Row };
}

/** The person's next-steps page. The address only after the leader has said hi. */
export async function personPage(db: Db, raw: string, now = new Date()): Promise<{ ok: true; view: PlacementView } | Fail> {
  const found = await byToken(db, "person", raw);
  if (!found.ok) return found;
  const [view] = await shape(db, [found.row], false, now);
  const hidden = !view!.saidHiAt && !view!.joinedAt;
  return { ok: true, view: { ...view!, house: { ...view!.house, location: hidden ? null : view!.house.location } } };
}

/** "I can't make it this week": the leader sees it; the welcome moves to next week. */
export async function personCantMakeIt(db: Db, raw: string, now = new Date()): Promise<{ ok: true } | Fail> {
  const found = await byToken(db, "person", raw);
  if (!found.ok) return found;
  if (found.row.joined_at || found.row.cancelled_at) return { ok: true };
  const updated = await db.from("missio_placements").update({ cant_make_it_at: now.toISOString() }).eq("id", found.row.id);
  if (updated.error) return fail(500, "server_error", "Something went wrong.");
  await audit(db, null, "missio.placement_cant_make_it", found.row.id, {});
  return { ok: true };
}

/** The leader's page. Phone of the person so they can say hi. */
export async function leaderPage(db: Db, raw: string, now = new Date()): Promise<{ ok: true; view: PlacementView } | Fail> {
  const found = await byToken(db, "leader", raw);
  if (!found.ok) return found;
  const [view] = await shape(db, [found.row], true, now);
  return { ok: true, view: { ...view!, leaders: [] } };
}

const leaderStepSchema = z.object({ step: z.enum(["said_hi", "first_visit", "joined"]) }).strict();

export async function leaderStep(db: Db, raw: string, body: unknown, now = new Date()): Promise<{ ok: true; view: PlacementView } | Fail> {
  const parsed = leaderStepSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const found = await byToken(db, "leader", raw);
  if (!found.ok) return found;
  const failed = await applyStep(db, found.row, parsed.data.step, null, now);
  if (failed && failed.code !== "already_resolved") return failed;
  return leaderPage(db, raw, now);
}
