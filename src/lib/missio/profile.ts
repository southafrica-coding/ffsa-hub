import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgAccess } from "@/lib/missio/access";
import { nextLeaderJourney } from "@/lib/missio/next-leaders";
import { loadPerson } from "@/lib/missio/people";
import type { HouseChurchRole, MissioErrorCode, MissioPerson } from "@/lib/missio/types";

/**
 * A Missio person's profile and journey (design board M2c).
 *
 * The journey is derived from rows that already exist: the Missio people
 * row, house memberships, follow-up stage history and connect cards. There
 * is no journey_events table yet, so only what those tables recorded shows.
 * Missio pastors see phone and email in full (Jack, 19 Nov 2026), so they
 * can call or WhatsApp from the profile. Each read is audited.
 */

export type ProfileHouse = {
  membershipId: string;
  houseId: string;
  number: number;
  name: string | null;
  role: HouseChurchRole;
  startedAt: string;
  endedAt: string | null;
};

export type FollowupStage = "new" | "contacted" | "visited_house" | "joined";

export type JourneyEvent =
  | { id: string; at: string; type: "added" }
  | { id: string; at: string; type: "joined_house" | "left_house"; houseId: string; number: number; name: string | null; role: HouseChurchRole }
  | { id: string; at: string; type: "followup_stage"; stage: FollowupStage }
  | { id: string; at: string; type: "followup_note"; note: string }
  | {
      id: string;
      at: string;
      type: "next_leader";
      stage: "spotted" | "in_training" | "ready";
      trainer: string | null;
      number: number;
      name: string | null;
    }
  | {
      id: string;
      at: string;
      type: "connect_card";
      visitType: "first_time" | "been_a_while" | "regular" | null;
      wantsHouseChurch: boolean;
      wantsPrayer: boolean;
    };

export type PersonProfile = {
  person: MissioPerson;
  /** In full. Null when the contact has none. Pastors only. */
  contact: { email: string | null; phone: string | null };
  /** Current memberships first, then past ones, newest first. */
  houses: ProfileHouse[];
  /** Newest first. */
  journey: JourneyEvent[];
};

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode };

const ROLES: readonly string[] = ["leader", "co_leader", "member"];
const STAGES: readonly string[] = ["new", "contacted", "visited_house", "joined"];

/** A date-only value sorts as the start of that day. */
function instant(value: string): number {
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(time) ? 0 : time;
}

export async function getPersonProfile(
  auth: OrgAccess,
  personId: string
): Promise<{ ok: true; profile: PersonProfile } | Fail> {
  const loaded = await loadPerson(auth.supabase, auth.orgId, personId);
  if ("error" in loaded) return { ok: false, status: loaded.status, error: loaded.error, code: loaded.code };
  const person = loaded.person;
  const contactId = person.contactId;
  const journey: JourneyEvent[] = [];

  const added = await auth.supabase
    .from("org_people")
    .select("created_at")
    .eq("id", personId)
    .eq("org_id", auth.orgId)
    .maybeSingle();
  const addedAt = (added.data as { created_at?: string } | null)?.created_at;
  if (addedAt) journey.push({ id: `added-${personId}`, at: addedAt, type: "added" });

  // House memberships. A failed read leaves the section empty instead of
  // failing the whole profile.
  const houses: ProfileHouse[] = [];
  const members = await auth.supabase
    .from("house_church_members")
    .select("id, house_church_id, role, started_at, ended_at")
    .eq("contact_id", contactId);
  if (members.error) console.error("[missio] profile memberships failed", members.error.message);
  const memberRows = (members.data ?? []) as Array<{
    id: string;
    house_church_id: string;
    role: string;
    started_at: string;
    ended_at: string | null;
  }>;
  if (memberRows.length > 0) {
    const houseRows = await auth.supabase
      .from("house_churches")
      .select("id, number, name")
      .eq("org_id", auth.orgId)
      .in("id", [...new Set(memberRows.map((row) => row.house_church_id))]);
    if (houseRows.error) console.error("[missio] profile houses failed", houseRows.error.message);
    const byId = new Map(
      ((houseRows.data ?? []) as Array<{ id: string; number: number; name: string | null }>).map((row) => [row.id, row])
    );
    for (const row of memberRows) {
      const house = byId.get(row.house_church_id);
      if (!house || !ROLES.includes(row.role)) continue;
      const role = row.role as HouseChurchRole;
      houses.push({
        membershipId: row.id,
        houseId: house.id,
        number: house.number,
        name: house.name ?? null,
        role,
        startedAt: row.started_at,
        endedAt: row.ended_at ?? null,
      });
      const base = { houseId: house.id, number: house.number, name: house.name ?? null, role };
      journey.push({ id: `in-${row.id}`, at: row.started_at, type: "joined_house", ...base });
      if (row.ended_at) journey.push({ id: `out-${row.id}`, at: row.ended_at, type: "left_house", ...base });
    }
    houses.sort((a, b) => {
      if (Boolean(a.endedAt) !== Boolean(b.endedAt)) return a.endedAt ? 1 : -1;
      return instant(b.startedAt) - instant(a.startedAt);
    });
  }

  // Next leaders (board M12d). Best effort.
  for (const step of await nextLeaderJourney(auth, contactId)) {
    journey.push({ id: step.id, at: step.at, type: "next_leader", stage: step.stage, trainer: step.trainer, number: step.houseNumber, name: step.houseName });
  }

  // Follow-up history and connect cards.
  const cardIds = new Set<string>();
  const followups = await auth.supabase
    .from("missio_followups")
    .select("id, connect_response_id")
    .eq("org_id", auth.orgId)
    .eq("contact_id", contactId);
  if (followups.error) console.error("[missio] profile follow-ups failed", followups.error.message);
  const followupRows = (followups.data ?? []) as Array<{ id: string; connect_response_id: string | null }>;
  for (const row of followupRows) if (row.connect_response_id) cardIds.add(row.connect_response_id);
  if (followupRows.length > 0) {
    const history = await auth.supabase
      .from("missio_followup_stage_history")
      .select("id, kind, to_stage, changed_at, notes, connect_response_id")
      .in(
        "followup_id",
        followupRows.map((row) => row.id)
      );
    if (history.error) console.error("[missio] profile follow-up history failed", history.error.message);
    for (const row of (history.data ?? []) as Array<{
      id: string;
      kind: string;
      to_stage: string | null;
      changed_at: string;
      notes: string | null;
      connect_response_id: string | null;
    }>) {
      if (row.kind === "connect_card" && row.connect_response_id) cardIds.add(row.connect_response_id);
      else if (row.kind === "note" && row.notes?.trim()) {
        journey.push({ id: `note-${row.id}`, at: row.changed_at, type: "followup_note", note: row.notes.trim() });
      } else if (row.kind === "stage_change" && row.to_stage && STAGES.includes(row.to_stage) && row.to_stage !== "new") {
        journey.push({ id: `stage-${row.id}`, at: row.changed_at, type: "followup_stage", stage: row.to_stage as FollowupStage });
      }
    }
  }
  const cards = await auth.supabase
    .from("connect_responses")
    .select("id, submitted_at, visit_type, wants_house_church, wants_prayer, matched_contact_id")
    .eq("org_id", auth.orgId)
    .eq("matched_contact_id", contactId);
  if (cards.error) console.error("[missio] profile connect cards failed", cards.error.message);
  const cardRows = new Map<string, Record<string, unknown>>();
  for (const row of (cards.data ?? []) as Array<Record<string, unknown>>) cardRows.set(String(row.id), row);
  const missing = [...cardIds].filter((id) => !cardRows.has(id));
  if (missing.length > 0) {
    const more = await auth.supabase
      .from("connect_responses")
      .select("id, submitted_at, visit_type, wants_house_church, wants_prayer")
      .eq("org_id", auth.orgId)
      .in("id", missing);
    if (more.error) console.error("[missio] profile connect cards failed", more.error.message);
    for (const row of (more.data ?? []) as Array<Record<string, unknown>>) cardRows.set(String(row.id), row);
  }
  for (const row of cardRows.values()) {
    const visit = row.visit_type;
    journey.push({
      id: `card-${String(row.id)}`,
      at: String(row.submitted_at ?? ""),
      type: "connect_card",
      visitType: visit === "first_time" || visit === "been_a_while" || visit === "regular" ? visit : null,
      wantsHouseChurch: row.wants_house_church === true,
      wantsPrayer: row.wants_prayer === true,
    });
  }

  journey.sort((a, b) => instant(b.at) - instant(a.at));

  // Contact details. The service-role read comes after the pastor check
  // that produced `auth`. Every profile read that returns them is audited.
  const contact: PersonProfile["contact"] = { email: null, phone: null };
  try {
    const admin = createAdminClient();
    const found = await admin.from("contacts").select("email, phone").eq("id", contactId).maybeSingle();
    if (found.error) console.error("[missio] profile contact failed", found.error.message);
    const row = found.data as { email?: string | null; phone?: string | null } | null;
    contact.email = row?.email?.trim() || null;
    contact.phone = row?.phone?.trim() || null;
    if (contact.email || contact.phone) {
      const logged = await admin.from("audit_logs").insert({
        user_id: auth.user.id,
        action: "missio.person_contact_view",
        resource_type: "contact",
        resource_id: contactId,
        changes: { email: Boolean(contact.email), phone: Boolean(contact.phone) },
        created_at: new Date().toISOString(),
      });
      if (logged.error) console.error("[missio] audit failed", logged.error.message ?? "insert failed");
    }
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
  }

  return { ok: true, profile: { person, contact, houses, journey: journey.filter((event) => event.at) } };
}
