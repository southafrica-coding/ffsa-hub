import { z } from "zod";
import type { OrgAccess } from "@/lib/missio/access";
import { houseInScope, type HouseScope } from "@/lib/missio/house-churches";
import type { MissioErrorCode } from "@/lib/missio/types";

/**
 * Next leaders, the training pipeline (board M12d). Migration 342.
 *
 * Someone in a house is nominated and moves spotted → in training → ready
 * to lead, with who is training them and a short note. Co-leaders without
 * a nomination show as "in training" by default; moving one creates the
 * row. Pastors anywhere, coaches across their houses, leaders in their own
 * house. Reads and writes use the caller's session (RLS 342).
 */

export type NextLeaderStage = "spotted" | "in_training" | "ready";
export const NEXT_LEADER_STAGES: readonly NextLeaderStage[] = ["spotted", "in_training", "ready"];

export type NextLeader = {
  /** Row id, or "co:<houseId>:<contactId>" for a co-leader with no nomination yet. */
  id: string;
  virtual: boolean;
  contactId: string;
  personId: string | null;
  name: string;
  house: { id: string; number: number; name: string | null };
  trainer: { contactId: string; name: string } | null;
  stage: NextLeaderStage;
  note: string | null;
  /** When they reached the current stage. */
  since: string | null;
};

export type PipelineHouse = {
  id: string;
  number: number;
  name: string | null;
  memberCount: number;
  /** Names of people ready to lead in this house. */
  ready: string[];
};

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode };
const fail = (status: number, code: MissioErrorCode, error: string): Fail => ({ ok: false, status, code, error });
const broken = () => fail(500, "server_error", "Something went wrong.");

type Row = {
  id: string;
  contact_id: string;
  house_church_id: string;
  trainer_contact_id: string | null;
  stage: NextLeaderStage;
  note: string | null;
  spotted_at: string;
  training_at: string | null;
  ready_at: string | null;
};
const COLUMNS = "id, contact_id, house_church_id, trainer_contact_id, stage, note, spotted_at, training_at, ready_at";

type MemberRow = { house_church_id: string; contact_id: string; role: string };
type HouseRow = { id: string; number: number; name: string | null };

function sinceOf(row: Pick<Row, "stage" | "spotted_at" | "training_at" | "ready_at">): string | null {
  if (row.stage === "ready") return row.ready_at;
  if (row.stage === "in_training") return row.training_at;
  return row.spotted_at;
}

async function names(auth: OrgAccess, contactIds: string[]): Promise<Map<string, { name: string; personId: string }> | Fail> {
  const map = new Map<string, { name: string; personId: string }>();
  const ids = [...new Set(contactIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const read = await auth.supabase
      .from("org_people_directory")
      .select("id, contact_id, first_name, last_name, preferred_name")
      .eq("org_id", auth.orgId)
      .in("contact_id", ids.slice(i, i + 100));
    if (read.error) return broken();
    for (const row of (read.data ?? []) as Array<{ id: string; contact_id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }>) {
      const name = [row.preferred_name || row.first_name, row.last_name].filter(Boolean).join(" ").trim();
      map.set(row.contact_id, { name: name || "Someone", personId: row.id });
    }
  }
  return map;
}

/** Houses in scope with their current members (leaders, co-leaders, members). */
async function housesIn(auth: OrgAccess, scope: HouseScope): Promise<{ houses: HouseRow[]; members: MemberRow[] } | Fail> {
  if (scope.mode === "houses" && scope.ids.length === 0) return { houses: [], members: [] };
  let query = auth.supabase.from("house_churches").select("id, number, name").eq("org_id", auth.orgId);
  if (scope.mode === "houses") query = query.in("id", [...scope.ids]);
  const houses = await query;
  if (houses.error) return broken();
  const houseRows = (houses.data ?? []) as HouseRow[];
  if (houseRows.length === 0) return { houses: [], members: [] };
  const members = await auth.supabase
    .from("house_church_members")
    .select("house_church_id, contact_id, role")
    .in("house_church_id", houseRows.map((house) => house.id))
    .is("ended_at", null);
  if (members.error) return broken();
  return { houses: houseRows, members: (members.data ?? []) as MemberRow[] };
}

function firstLeader(members: MemberRow[], houseId: string): string | null {
  return members.find((member) => member.house_church_id === houseId && member.role === "leader")?.contact_id ?? null;
}

export async function listNextLeaders(
  auth: OrgAccess,
  scope: HouseScope
): Promise<{ ok: true; leaders: NextLeader[]; houses: PipelineHouse[] } | Fail> {
  const loaded = await housesIn(auth, scope);
  if ("ok" in loaded) return loaded;
  const { houses, members } = loaded;
  if (houses.length === 0) return { ok: true, leaders: [], houses: [] };
  const read = await auth.supabase
    .from("missio_next_leaders")
    .select(COLUMNS)
    .in("house_church_id", houses.map((house) => house.id))
    .is("ended_at", null);
  let rows: Row[] = [];
  if (read.error) {
    // Before migration 342 the table is missing: show co-leaders only.
    if (read.error.code !== "42P01" && read.error.code !== "PGRST205") return broken();
  } else rows = (read.data ?? []) as Row[];

  const nominated = new Set(rows.map((row) => row.contact_id));
  const coLeaders = members.filter((member) => member.role === "co_leader" && !nominated.has(member.contact_id));
  const byName = await names(auth, [
    ...rows.map((row) => row.contact_id),
    ...rows.map((row) => row.trainer_contact_id).filter((id): id is string => Boolean(id)),
    ...coLeaders.map((member) => member.contact_id),
    ...members.filter((member) => member.role === "leader").map((member) => member.contact_id),
  ]);
  if ("ok" in byName) return byName;
  const houseOf = new Map(houses.map((house) => [house.id, house]));
  const nameOf = (id: string) => byName.get(id)?.name ?? "Someone";

  const leaders: NextLeader[] = [
    ...rows
      .filter((row) => houseOf.has(row.house_church_id))
      .map((row) => {
        const house = houseOf.get(row.house_church_id)!;
        return {
          id: row.id,
          virtual: false,
          contactId: row.contact_id,
          personId: byName.get(row.contact_id)?.personId ?? null,
          name: nameOf(row.contact_id),
          house: { id: house.id, number: house.number, name: house.name },
          trainer: row.trainer_contact_id ? { contactId: row.trainer_contact_id, name: nameOf(row.trainer_contact_id) } : null,
          stage: row.stage,
          note: row.note,
          since: sinceOf(row),
        };
      }),
    ...coLeaders.map((member) => {
      const house = houseOf.get(member.house_church_id)!;
      const trainer = firstLeader(members, member.house_church_id);
      return {
        id: `co:${member.house_church_id}:${member.contact_id}`,
        virtual: true,
        contactId: member.contact_id,
        personId: byName.get(member.contact_id)?.personId ?? null,
        name: nameOf(member.contact_id),
        house: { id: house.id, number: house.number, name: house.name },
        trainer: trainer ? { contactId: trainer, name: nameOf(trainer) } : null,
        stage: "in_training" as const,
        note: "Co-leading.",
        since: null,
      };
    }),
  ].sort((a, b) => a.house.number - b.house.number || a.name.localeCompare(b.name));

  const pipelineHouses: PipelineHouse[] = houses
    .map((house) => ({
      id: house.id,
      number: house.number,
      name: house.name,
      memberCount: members.filter((member) => member.house_church_id === house.id).length,
      ready: leaders.filter((leader) => leader.house.id === house.id && leader.stage === "ready").map((leader) => leader.name),
    }))
    .sort((a, b) => a.number - b.number);

  return { ok: true, leaders, houses: pipelineHouses };
}

const nominateSchema = z
  .object({
    contactId: z.string().uuid(),
    houseId: z.string().uuid(),
    trainerContactId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(280).optional(),
    stage: z.enum(["spotted", "in_training", "ready"]).optional(),
  })
  .strict();

function stampsFor(stage: NextLeaderStage, at: string, existing?: Partial<Row>) {
  const stamps: Record<string, string> = {};
  if (stage === "in_training" || stage === "ready") stamps.training_at = existing?.training_at ?? at;
  if (stage === "ready") stamps.ready_at = existing?.ready_at ?? at;
  return stamps;
}

/** Nominate someone in one of the caller's houses. They must be in that house now. */
export async function nominate(auth: OrgAccess, scope: HouseScope, body: unknown, now = new Date()) {
  const parsed = nominateSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const input = parsed.data;
  if (!houseInScope(scope, input.houseId)) return fail(404, "not_found", "House not found.");
  const member = await auth.supabase
    .from("house_church_members")
    .select("contact_id")
    .eq("house_church_id", input.houseId)
    .is("ended_at", null)
    .in("contact_id", [input.contactId, ...(input.trainerContactId ? [input.trainerContactId] : [])]);
  if (member.error) return broken();
  const inHouse = new Set(((member.data ?? []) as Array<{ contact_id: string }>).map((row) => row.contact_id));
  if (!inHouse.has(input.contactId)) return fail(400, "membership_not_current", "They need to be in this house.");
  if (input.trainerContactId && !inHouse.has(input.trainerContactId)) return fail(400, "invalid_input", "The trainer needs to be in this house.");
  const stage = input.stage ?? "spotted";
  const at = now.toISOString();
  const inserted = await auth.supabase
    .from("missio_next_leaders")
    .insert({
      org_id: auth.orgId,
      contact_id: input.contactId,
      house_church_id: input.houseId,
      trainer_contact_id: input.trainerContactId ?? null,
      stage,
      note: input.note?.trim() || null,
      spotted_at: at,
      ...stampsFor(stage, at),
      nominated_by: auth.user.id,
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") return fail(409, "conflict", "They’re already on the list.");
    return broken();
  }
  return { ok: true as const, id: (inserted.data as { id: string }).id };
}

const moveSchema = z
  .object({
    stage: z.enum(["spotted", "in_training", "ready"]).optional(),
    note: z.string().trim().max(280).nullable().optional(),
    trainerContactId: z.string().uuid().nullable().optional(),
    remove: z.literal(true).optional(),
  })
  .strict();

/** Move a card, change its note or trainer, or take it off the list. A co-leader card is created on first move. */
export async function moveNextLeader(auth: OrgAccess, scope: HouseScope, id: string, body: unknown, now = new Date()) {
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const input = parsed.data;
  const co = /^co:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(id);
  if (co) {
    if (input.remove) return fail(400, "invalid_input", "Co-leaders stay on the list while they co-lead.");
    const houseId = co[1]!;
    const leader = await auth.supabase
      .from("house_church_members")
      .select("contact_id")
      .eq("house_church_id", houseId)
      .eq("role", "leader")
      .is("ended_at", null)
      .limit(1);
    const trainer = ((leader.data ?? []) as Array<{ contact_id: string }>)[0]?.contact_id ?? null;
    return nominate(
      auth,
      scope,
      {
        contactId: co[2],
        houseId,
        stage: input.stage ?? "in_training",
        ...(input.note ? { note: input.note } : {}),
        trainerContactId: input.trainerContactId !== undefined ? input.trainerContactId : trainer,
      },
      now
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Not found.");
  const read = await auth.supabase.from("missio_next_leaders").select(COLUMNS).eq("id", id).is("ended_at", null).maybeSingle();
  if (read.error) return broken();
  const row = read.data as Row | null;
  if (!row || !houseInScope(scope, row.house_church_id)) return fail(404, "not_found", "Not found.");
  const at = now.toISOString();
  const patch: Record<string, unknown> = {};
  if (input.remove) patch.ended_at = at;
  if (input.stage) Object.assign(patch, { stage: input.stage }, stampsFor(input.stage, at, row));
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (input.trainerContactId !== undefined) patch.trainer_contact_id = input.trainerContactId;
  if (Object.keys(patch).length === 0) return { ok: true as const, id };
  const saved = await auth.supabase.from("missio_next_leaders").update(patch).eq("id", id);
  if (saved.error) return broken();
  return { ok: true as const, id };
}

/** Journey lines for one person: "Spotted as a next leader", "In training with Esther", "Ready to lead". */
export async function nextLeaderJourney(
  auth: OrgAccess,
  contactId: string
): Promise<Array<{ id: string; at: string; stage: NextLeaderStage; trainer: string | null; houseNumber: number; houseName: string | null }>> {
  const read = await auth.supabase.from("missio_next_leaders").select(COLUMNS).eq("contact_id", contactId);
  if (read.error || !read.data) return [];
  const rows = read.data as Row[];
  if (rows.length === 0) return [];
  const houses = await auth.supabase.from("house_churches").select("id, number, name").in("id", [...new Set(rows.map((row) => row.house_church_id))]);
  const byHouse = new Map(((houses.data ?? []) as HouseRow[]).map((house) => [house.id, house]));
  const trainers = await names(auth, rows.map((row) => row.trainer_contact_id).filter((id): id is string => Boolean(id)));
  const trainerName = (id: string | null) => (id && !("ok" in trainers) ? (trainers.get(id)?.name.split(" ")[0] ?? null) : null);
  const out: Array<{ id: string; at: string; stage: NextLeaderStage; trainer: string | null; houseNumber: number; houseName: string | null }> = [];
  for (const row of rows) {
    const house = byHouse.get(row.house_church_id);
    const base = { trainer: trainerName(row.trainer_contact_id), houseNumber: house?.number ?? 0, houseName: house?.name ?? null };
    out.push({ id: `nl-s-${row.id}`, at: row.spotted_at, stage: "spotted", ...base });
    if (row.training_at) out.push({ id: `nl-t-${row.id}`, at: row.training_at, stage: "in_training", ...base });
    if (row.ready_at) out.push({ id: `nl-r-${row.id}`, at: row.ready_at, stage: "ready", ...base });
  }
  return out;
}
