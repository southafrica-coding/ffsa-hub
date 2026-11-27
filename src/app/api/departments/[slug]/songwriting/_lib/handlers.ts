// The Songwriting department API (417 + 424), one function per route. The
// route files next to this folder only unwrap params and call these.
//
//   GET    /songwriting                          everything the pages read (#745's SongwritingData) + viewer
//   GET    /songwriting/nations                  nations
//   POST   /songwriting/nations                  { name, slug?, continent?, status?, notes?, iso_code?, languages? }
//   GET    /songwriting/nations/:id              one nation
//   PATCH  /songwriting/nations/:id              any of those fields
//   DELETE /songwriting/nations/:id              409 nation_has_leads / nation_has_trainings / nation_in_use when still used
//   GET    /songwriting/trainings                trainings and their facilitators
//   POST   /songwriting/trainings                #745's TrainingInput + training_date?
//   GET    /songwriting/trainings/:id            one training with facilitators
//   PATCH  /songwriting/trainings/:id            any TrainingInput field + training_date (facilitators replace the list)
//   DELETE /songwriting/trainings/:id            (facilitators go with it; leads keep their row, source cleared)
//   GET    /songwriting/leads                    ?status=a,b &kind= &nation_id= &source_training_id= &contact_user_id= &owner=<id>|me|none &q= &limit=
//   POST   /songwriting/leads                    { label, kind?, contact_user_id?, source_training_id?, nation_id?, note?, owner_user_id?, status? }
//   GET    /songwriting/leads/:id                { lead, events }
//   PATCH  /songwriting/leads/:id                any of those fields
//   DELETE /songwriting/leads/:id                (its logged contacts go with it)
//   GET    /songwriting/leads/:id/events         logged contacts, newest first
//   POST   /songwriting/leads/:id/events         { note, at? } → { lead, event } (last_contact_at moves forward)
//   DELETE /songwriting/leads/:id/events/:eid    the person who logged it, or an admin (else 403; 0 rows deleted is 403, never a silent 200)
//
// 424 owns three columns: pw_songwriting_leads.created_by and
// pw_songwriting_lead_events.by (stamped with auth.uid()) and
// last_contact_at (derived from events). The API never sends them and
// refuses them in a body (400 read_only_field); if the database refuses
// one anyway (42501 pw_songwriting_actor_locked / pw_lead_last_contact_derived)
// that is 400 read_only_field too. Trainings have no such trigger (417), so
// the API sets their created_by.
//
// Training date rule (424): training_date is optional, a YYYY-MM-DD date in
// the row's year and month. A PATCH that moves year/month must also move
// training_date into the new month or clear it (null), else 400
// training_date_outside_month with fieldErrors.training_date.
//
// Leads answer with owner_name (from owner_user_id); logged contacts with
// by_name. Names come from the service role, display-name columns only,
// after the access gate, for people on rows the caller can already read.
//
// Reads and writes use the caller's session, so 417/424's RLS applies
// (active P&W members and admins only). Every PATCH and DELETE asks ONE
// helper first: canEditSongwritingRecord (lib/songwriting/access).
//
// Errors: { error, code } (lib/songwriting/http). 401 signed out, 403 not
// allowed, 404 no such department / record, 400 bad body, 409 duplicate or
// a nation still in use.

import "server-only";

import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { isOpened, openDepartment, type OpenedDepartment } from "@/lib/departments/internal/open";
import { readJson } from "@/lib/departments/http";
import { rpcFlag } from "@/lib/departments/rpc";
import { isUuid } from "@/lib/departments/validate";
import type { PwSongwritingLead, PwSongwritingLeadEvent, PwSongwritingTraining, PwTrainingFacilitator } from "@/lib/departments/db.types";
import { canEditSongwritingRecord, SONGWRITING_EDIT_RULE, type SongwritingRecord, type SongwritingViewer } from "@/lib/songwriting/access";
import { coded, dbError, invalid, notAuthorized, notFound } from "@/lib/songwriting/http";
import {
  personName,
  PERSON_COLUMNS,
  SONGWRITING_DEPARTMENT_SLUGS,
  SW_CODES,
  SW_COLUMNS,
  SW_TABLES,
  type Person,
  type Row,
  type SongwritingLeadEventOut,
  type SongwritingLeadOut,
} from "@/lib/songwriting/types";
import {
  LEADS_MAX,
  likePattern,
  parseEventCreate,
  parseLeadCreate,
  parseLeadFilters,
  parseLeadPatch,
  parseNationCreate,
  parseNationPatch,
  parseTrainingCreate,
  parseTrainingPatch,
  type FacilitatorInput,
  type Failure,
} from "@/lib/songwriting/validate";

type Ctx = OpenedDepartment & { viewer: SongwritingViewer };
type Opened = { response: NextResponse } | Ctx;
const isCtx = (r: Opened): r is Ctx => !("response" in r);

/** Seams for the tests. */
export type SwDeps = { now?: () => Date };

async function open(slug: string): Promise<Opened> {
  const opened = await openDepartment(slug, "any");
  if (!isOpened(opened)) return opened;
  if (!SONGWRITING_DEPARTMENT_SLUGS.includes(opened.department.slug)) return { response: notFound("Department not found") };
  const [access, admin, leader] = await Promise.all([
    rpcFlag(opened.supabase, "pw_can_access_songwriting"),
    rpcFlag(opened.supabase, "is_admin"),
    rpcFlag(opened.supabase, "dept_is_ministry_leader", { p_ministry_id: opened.department.id }),
  ]);
  if (!access.ok || !access.value) return { response: notAuthorized("Only active Prayer & Worship members and admins can use Songwriting") };
  return {
    ...opened,
    viewer: {
      userId: opened.userId,
      canAccess: true,
      // A failed flag is "no": it can only narrow what the API allows.
      isAdmin: admin.ok && admin.value,
      isLeader: leader.ok && leader.value,
    },
  };
}

async function audit(ctx: Ctx, action: string, resourceType: string, resourceId: string, changes?: Record<string, unknown>) {
  await createAuditLog(ctx.supabase, { action, resource_type: resourceType, resource_id: resourceId, changes: changes ?? null }).catch(
    (error: unknown) => console.error(error)
  );
}

async function body(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const b = await readJson(request);
  return b.ok ? b : { ok: false, response: invalid({ error: "Send a JSON body" }) };
}

const fail = (p: Failure) => invalid(p);

function refuseEdit(ctx: Ctx, record: SongwritingRecord): NextResponse | null {
  return canEditSongwritingRecord(ctx.viewer, record) ? null : notAuthorized("You can't change this record");
}

function viewerOut(ctx: Ctx) {
  return { user_id: ctx.viewer.userId, is_admin: ctx.viewer.isAdmin, is_leader: ctx.viewer.isLeader, edit_rule: SONGWRITING_EDIT_RULE };
}

const deleted = (id: string) => NextResponse.json({ deleted: id });

// ── names ──────────────────────────────────────────────────

async function namesFor(ctx: Ctx, ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const r = await ctx.admin.from("users").select(PERSON_COLUMNS).in("id", unique);
  if (r.error) console.error("[songwriting] names", r.error);
  return new Map(((r.data ?? []) as Person[]).map((p) => [p.id, personName(p)]));
}

async function withOwnerNames(ctx: Ctx, leads: PwSongwritingLead[]): Promise<SongwritingLeadOut[]> {
  const names = await namesFor(ctx, leads.map((l) => l.owner_user_id));
  return leads.map((l) => ({ ...l, owner_name: l.owner_user_id ? (names.get(l.owner_user_id) ?? null) : null }));
}

async function withByNames(ctx: Ctx, events: PwSongwritingLeadEvent[]): Promise<SongwritingLeadEventOut[]> {
  const names = await namesFor(ctx, events.map((e) => e.by));
  return events.map((e) => ({ ...e, by_name: e.by ? (names.get(e.by) ?? null) : null }));
}

// ── loads ──────────────────────────────────────────────────

async function loadOne<T>(ctx: Ctx, table: string, columns: string, id: string): Promise<{ row: T | null; response?: NextResponse }> {
  if (!isUuid(id)) return { row: null };
  const r = await ctx.supabase.from(table).select(columns).eq("id", id).maybeSingle();
  if (r.error) return { row: null, response: dbError(r.error) };
  return { row: (r.data as T) ?? null };
}

async function facilitatorsOf(ctx: Ctx, trainingId: string) {
  return ctx.supabase.from(SW_TABLES.facilitators).select(SW_COLUMNS.facilitators).eq("training_id", trainingId).order("display_name");
}

// ── GET /songwriting ───────────────────────────────────────

export async function getOverview(slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const [nations, trainings, facilitators, leads, songs] = await Promise.all([
    ctx.supabase.from(SW_TABLES.nations).select(SW_COLUMNS.nations).order("name"),
    ctx.supabase.from(SW_TABLES.trainings).select(SW_COLUMNS.trainings).order("year", { ascending: false }).order("month", { ascending: false }),
    ctx.supabase.from(SW_TABLES.facilitators).select(SW_COLUMNS.facilitators).order("display_name"),
    ctx.supabase.from(SW_TABLES.leads).select(SW_COLUMNS.leads).order("updated_at", { ascending: false }).limit(LEADS_MAX),
    // Song Library (419) is base-wide; if it is not readable, the counts are 0.
    ctx.supabase.from(SW_TABLES.librarySongs).select("id, source_training_id"),
  ]);
  for (const r of [nations, trainings, facilitators, leads]) if (r.error) return dbError(r.error);
  const songRows = songs.error ? [] : ((songs.data ?? []) as { source_training_id: string | null }[]);
  const byTraining: Record<string, number> = {};
  for (const s of songRows) if (s.source_training_id) byTraining[s.source_training_id] = (byTraining[s.source_training_id] ?? 0) + 1;
  return NextResponse.json({
    nations: nations.data ?? [],
    trainings: trainings.data ?? [],
    facilitators: facilitators.data ?? [],
    leads: await withOwnerNames(ctx, (leads.data ?? []) as PwSongwritingLead[]),
    librarySongCount: songRows.length,
    librarySongsByTraining: byTraining,
    viewer: viewerOut(ctx),
  });
}

// ── Nations ────────────────────────────────────────────────

export async function listNations(slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const r = await ctx.supabase.from(SW_TABLES.nations).select(SW_COLUMNS.nations).order("name");
  if (r.error) return dbError(r.error);
  return NextResponse.json({ nations: r.data ?? [] });
}

export async function createNation(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseNationCreate(b.value);
  if (!parsed.ok) return fail(parsed);
  const ins = await ctx.supabase.from(SW_TABLES.nations).insert(parsed.value).select(SW_COLUMNS.nations).single();
  if (ins.error) return dbError(ins.error);
  await audit(ctx, "create", "pw_nation", ins.data.id, parsed.value);
  return NextResponse.json({ nation: ins.data }, { status: 201 });
}

export async function getNation(slug: string, nationId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const n = await loadOne<Row>(ctx, SW_TABLES.nations, SW_COLUMNS.nations, nationId);
  if (n.response) return n.response;
  if (!n.row) return notFound("Nation not found");
  return NextResponse.json({ nation: n.row });
}

export async function patchNation(request: Request, slug: string, nationId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const n = await loadOne<Row>(ctx, SW_TABLES.nations, SW_COLUMNS.nations, nationId);
  if (n.response) return n.response;
  if (!n.row) return notFound("Nation not found");
  const refused = refuseEdit(ctx, { kind: "nation" });
  if (refused) return refused;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseNationPatch(b.value);
  if (!parsed.ok) return fail(parsed);
  const up = await ctx.supabase.from(SW_TABLES.nations).update(parsed.value).eq("id", nationId).select(SW_COLUMNS.nations).maybeSingle();
  if (up.error) return dbError(up.error);
  if (!up.data) return notFound("Nation not found");
  await audit(ctx, "update", "pw_nation", nationId, parsed.value);
  return NextResponse.json({ nation: up.data });
}

export async function deleteNation(slug: string, nationId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const n = await loadOne<Row>(ctx, SW_TABLES.nations, SW_COLUMNS.nations, nationId);
  if (n.response) return n.response;
  if (!n.row) return notFound("Nation not found");
  const refused = refuseEdit(ctx, { kind: "nation" });
  if (refused) return refused;
  // 424/417: leads, trainings (and pw_songs) hold the nation ON DELETE RESTRICT.
  // Name the reason when we can see it; the database is the backstop (23503).
  const [leads, trainings] = await Promise.all([
    ctx.supabase.from(SW_TABLES.leads).select("id").eq("nation_id", nationId).limit(1),
    ctx.supabase.from(SW_TABLES.trainings).select("id").eq("nation_id", nationId).limit(1),
  ]);
  if (leads.error) return dbError(leads.error);
  if (trainings.error) return dbError(trainings.error);
  if ((leads.data ?? []).length) return coded(409, "This nation has leads. Move or delete them first.", SW_CODES.nationHasLeads);
  if ((trainings.data ?? []).length) return coded(409, "This nation has trainings. Move or delete them first.", SW_CODES.nationHasTrainings);
  const del = await ctx.supabase.from(SW_TABLES.nations).delete().eq("id", nationId).select("id");
  if (del.error) return dbError(del.error, { nationDelete: true });
  if (!(del.data ?? []).length) return notAuthorized();
  await audit(ctx, "delete", "pw_nation", nationId);
  return deleted(nationId);
}

// ── Trainings ──────────────────────────────────────────────

export async function listTrainings(slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const [t, f] = await Promise.all([
    ctx.supabase.from(SW_TABLES.trainings).select(SW_COLUMNS.trainings).order("year", { ascending: false }).order("month", { ascending: false }),
    ctx.supabase.from(SW_TABLES.facilitators).select(SW_COLUMNS.facilitators).order("display_name"),
  ]);
  if (t.error) return dbError(t.error);
  if (f.error) return dbError(f.error);
  return NextResponse.json({ trainings: t.data ?? [], facilitators: f.data ?? [] });
}

async function insertFacilitators(ctx: Ctx, trainingId: string, list: FacilitatorInput[]) {
  if (!list.length) return { error: null };
  return ctx.supabase.from(SW_TABLES.facilitators).insert(list.map((f) => ({ training_id: trainingId, display_name: f.display_name, person_id: f.person_id })));
}

export async function createTraining(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseTrainingCreate(b.value);
  if (!parsed.ok) return fail(parsed);
  const ins = await ctx.supabase
    .from(SW_TABLES.trainings)
    .insert({ ...parsed.value.row, source: "hub", created_by: ctx.userId })
    .select(SW_COLUMNS.trainings)
    .single();
  if (ins.error) return dbError(ins.error);
  const training = ins.data as PwSongwritingTraining;
  const fac = await insertFacilitators(ctx, training.id, parsed.value.facilitators ?? []);
  if (fac.error) {
    // No half-made training: take it back out, then report.
    await ctx.supabase.from(SW_TABLES.trainings).delete().eq("id", training.id);
    return dbError(fac.error);
  }
  const f = await facilitatorsOf(ctx, training.id);
  if (f.error) return dbError(f.error);
  await audit(ctx, "create", "pw_songwriting_training", training.id, parsed.value.row);
  return NextResponse.json({ training, facilitators: f.data ?? [] }, { status: 201 });
}

export async function getTraining(slug: string, trainingId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const t = await loadOne<PwSongwritingTraining>(ctx, SW_TABLES.trainings, SW_COLUMNS.trainings, trainingId);
  if (t.response) return t.response;
  if (!t.row) return notFound("Training not found");
  const f = await facilitatorsOf(ctx, trainingId);
  if (f.error) return dbError(f.error);
  return NextResponse.json({ training: t.row, facilitators: f.data ?? [] });
}

export async function patchTraining(request: Request, slug: string, trainingId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const t = await loadOne<PwSongwritingTraining>(ctx, SW_TABLES.trainings, SW_COLUMNS.trainings, trainingId);
  if (t.response) return t.response;
  if (!t.row) return notFound("Training not found");
  const refused = refuseEdit(ctx, { kind: "training", created_by: t.row.created_by });
  if (refused) return refused;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseTrainingPatch(b.value, t.row);
  if (!parsed.ok) return fail(parsed);

  let training = t.row;
  if (Object.keys(parsed.value.row).length) {
    const up = await ctx.supabase.from(SW_TABLES.trainings).update(parsed.value.row).eq("id", trainingId).select(SW_COLUMNS.trainings).maybeSingle();
    if (up.error) return dbError(up.error);
    if (!up.data) return notFound("Training not found");
    training = up.data as PwSongwritingTraining;
  }

  if (parsed.value.facilitators) {
    const now = await facilitatorsOf(ctx, trainingId);
    if (now.error) return dbError(now.error);
    const current = (now.data ?? []) as PwTrainingFacilitator[];
    const wanted = new Set(parsed.value.facilitators.map((f) => f.display_name));
    const gone = current.filter((f) => !wanted.has(f.display_name)).map((f) => f.id);
    const have = new Set(current.map((f) => f.display_name));
    if (gone.length) {
      const del = await ctx.supabase.from(SW_TABLES.facilitators).delete().in("id", gone);
      if (del.error) return dbError(del.error);
    }
    const add = await insertFacilitators(ctx, trainingId, parsed.value.facilitators.filter((f) => !have.has(f.display_name)));
    if (add.error) return dbError(add.error);
  }

  const f = await facilitatorsOf(ctx, trainingId);
  if (f.error) return dbError(f.error);
  await audit(ctx, "update", "pw_songwriting_training", trainingId, { ...parsed.value.row, ...(parsed.value.facilitators ? { facilitators: parsed.value.facilitators.map((x) => x.display_name) } : {}) });
  return NextResponse.json({ training, facilitators: f.data ?? [] });
}

export async function deleteTraining(slug: string, trainingId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const t = await loadOne<PwSongwritingTraining>(ctx, SW_TABLES.trainings, SW_COLUMNS.trainings, trainingId);
  if (t.response) return t.response;
  if (!t.row) return notFound("Training not found");
  const refused = refuseEdit(ctx, { kind: "training", created_by: t.row.created_by });
  if (refused) return refused;
  const del = await ctx.supabase.from(SW_TABLES.trainings).delete().eq("id", trainingId).select("id");
  if (del.error) return dbError(del.error);
  if (!(del.data ?? []).length) return notAuthorized();
  await audit(ctx, "delete", "pw_songwriting_training", trainingId);
  return deleted(trainingId);
}

// ── Leads ──────────────────────────────────────────────────

export async function listLeads(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const f = parseLeadFilters(new URL(request.url).searchParams, ctx.userId);
  if (!f.ok) return fail(f);
  let q = ctx.supabase.from(SW_TABLES.leads).select(SW_COLUMNS.leads);
  const v = f.value;
  if (v.status) q = q.in("status", v.status);
  if (v.kind) q = q.eq("kind", v.kind);
  if (v.nation_id) q = q.eq("nation_id", v.nation_id);
  if (v.source_training_id) q = q.eq("source_training_id", v.source_training_id);
  if (v.contact_user_id) q = q.eq("contact_user_id", v.contact_user_id);
  if (v.owner === "none") q = q.is("owner_user_id", null);
  else if (v.owner) q = q.eq("owner_user_id", v.owner);
  if (v.q) q = q.ilike("label", likePattern(v.q));
  const r = await q.order("updated_at", { ascending: false }).limit(v.limit);
  if (r.error) return dbError(r.error);
  return NextResponse.json({ leads: await withOwnerNames(ctx, (r.data ?? []) as PwSongwritingLead[]) });
}

async function leadOut(ctx: Ctx, id: string): Promise<{ lead: SongwritingLeadOut | null; response?: NextResponse }> {
  const l = await loadOne<PwSongwritingLead>(ctx, SW_TABLES.leads, SW_COLUMNS.leads, id);
  if (l.response) return { lead: null, response: l.response };
  if (!l.row) return { lead: null };
  return { lead: (await withOwnerNames(ctx, [l.row]))[0] };
}

export async function createLead(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseLeadCreate(b.value);
  if (!parsed.ok) return fail(parsed);
  // Never send created_by or last_contact_at: 424 stamps created_by with
  // auth.uid() for signed-in callers and derives last_contact_at from events.
  const ins = await ctx.supabase.from(SW_TABLES.leads).insert(parsed.value).select(SW_COLUMNS.leads).single();
  if (ins.error) return dbError(ins.error);
  await audit(ctx, "create", "pw_songwriting_lead", ins.data.id, parsed.value);
  return NextResponse.json({ lead: (await withOwnerNames(ctx, [ins.data as PwSongwritingLead]))[0] }, { status: 201 });
}

export async function getLead(slug: string, leadId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const l = await leadOut(ctx, leadId);
  if (l.response) return l.response;
  if (!l.lead) return notFound("Lead not found");
  const e = await ctx.supabase.from(SW_TABLES.events).select(SW_COLUMNS.events).eq("lead_id", leadId).order("at", { ascending: false });
  if (e.error) return dbError(e.error);
  return NextResponse.json({ lead: l.lead, events: await withByNames(ctx, (e.data ?? []) as PwSongwritingLeadEvent[]) });
}

export async function patchLead(request: Request, slug: string, leadId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const l = await loadOne<PwSongwritingLead>(ctx, SW_TABLES.leads, SW_COLUMNS.leads, leadId);
  if (l.response) return l.response;
  if (!l.row) return notFound("Lead not found");
  const refused = refuseEdit(ctx, { kind: "lead", created_by: l.row.created_by });
  if (refused) return refused;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseLeadPatch(b.value);
  if (!parsed.ok) return fail(parsed);
  const up = await ctx.supabase.from(SW_TABLES.leads).update(parsed.value).eq("id", leadId).select(SW_COLUMNS.leads).maybeSingle();
  if (up.error) return dbError(up.error);
  if (!up.data) return notFound("Lead not found");
  await audit(ctx, "update", "pw_songwriting_lead", leadId, parsed.value);
  return NextResponse.json({ lead: (await withOwnerNames(ctx, [up.data as PwSongwritingLead]))[0] });
}

export async function deleteLead(slug: string, leadId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const l = await loadOne<PwSongwritingLead>(ctx, SW_TABLES.leads, SW_COLUMNS.leads, leadId);
  if (l.response) return l.response;
  if (!l.row) return notFound("Lead not found");
  const refused = refuseEdit(ctx, { kind: "lead", created_by: l.row.created_by });
  if (refused) return refused;
  const del = await ctx.supabase.from(SW_TABLES.leads).delete().eq("id", leadId).select("id");
  if (del.error) return dbError(del.error);
  if (!(del.data ?? []).length) return notAuthorized();
  await audit(ctx, "delete", "pw_songwriting_lead", leadId);
  return deleted(leadId);
}

// ── Lead events (Log contact) ──────────────────────────────

export async function listLeadEvents(slug: string, leadId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const l = await loadOne<PwSongwritingLead>(ctx, SW_TABLES.leads, "id", leadId);
  if (l.response) return l.response;
  if (!l.row) return notFound("Lead not found");
  const e = await ctx.supabase.from(SW_TABLES.events).select(SW_COLUMNS.events).eq("lead_id", leadId).order("at", { ascending: false });
  if (e.error) return dbError(e.error);
  return NextResponse.json({ events: await withByNames(ctx, (e.data ?? []) as PwSongwritingLeadEvent[]) });
}

export async function addLeadEvent(request: Request, slug: string, leadId: string, deps: SwDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const l = await loadOne<PwSongwritingLead>(ctx, SW_TABLES.leads, "id", leadId);
  if (l.response) return l.response;
  if (!l.row) return notFound("Lead not found");
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseEventCreate(b.value, (deps.now ?? (() => new Date()))());
  if (!parsed.ok) return fail(parsed);
  // Never send by: 424 stamps it with auth.uid(). last_contact_at follows in
  // the database. There is no UPDATE route: logged contacts are append-only.
  const ins = await ctx.supabase.from(SW_TABLES.events).insert({ lead_id: leadId, ...parsed.value }).select(SW_COLUMNS.events).single();
  if (ins.error) return dbError(ins.error);
  const lead = await leadOut(ctx, leadId);
  if (lead.response) return lead.response;
  await audit(ctx, "create", "pw_songwriting_lead_event", ins.data.id, { lead_id: leadId });
  return NextResponse.json({ lead: lead.lead, event: (await withByNames(ctx, [ins.data as PwSongwritingLeadEvent]))[0] }, { status: 201 });
}

export async function deleteLeadEvent(slug: string, leadId: string, eventId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  if (!isUuid(leadId) || !isUuid(eventId)) return notFound("Logged contact not found");
  const e = await ctx.supabase.from(SW_TABLES.events).select(SW_COLUMNS.events).eq("id", eventId).eq("lead_id", leadId).maybeSingle();
  if (e.error) return dbError(e.error);
  if (!e.data) return notFound("Logged contact not found");
  const refused = refuseEdit(ctx, { kind: "lead_event", by: (e.data as PwSongwritingLeadEvent).by });
  if (refused) return refused;
  const del = await ctx.supabase.from(SW_TABLES.events).delete().eq("id", eventId).select("id");
  if (del.error) return dbError(del.error);
  if (!(del.data ?? []).length) return notAuthorized();
  const lead = await leadOut(ctx, leadId);
  if (lead.response) return lead.response;
  await audit(ctx, "delete", "pw_songwriting_lead_event", eventId, { lead_id: leadId });
  return NextResponse.json({ lead: lead.lead, deleted: eventId });
}
