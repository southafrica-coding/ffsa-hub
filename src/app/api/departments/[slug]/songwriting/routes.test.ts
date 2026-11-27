import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { MemoryDb } from "@/lib/song-library/testing/memory-db";
import {
  ADMIN,
  E_FIRST,
  GROUNDS_SLUG,
  INACTIVE,
  LEADER,
  L_GROUP,
  L_OPEN,
  MEMBER,
  MEMBER2,
  N_EMPTY,
  N_TRAINED,
  N_TZ,
  OUTSIDER,
  PW_SLUG,
  T_IMPORTED,
  T_MARCH,
  makeWorld,
  serviceClient,
  sessionClient,
} from "@/lib/songwriting/testing/world";

const h = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown as MemoryDb }));

vi.mock("@/lib/departments/internal/open", () => ({
  isOpened: (r: object) => !("response" in r),
  // Stands in for the department routes' gate: signed in, active, and a department from the slug.
  openDepartment: async (slug: string) => {
    if (!h.userId) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    if (h.userId === INACTIVE) return { response: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
    const dept = h.db.tables.staff_ministries.find((d) => d.slug === slug);
    if (!dept) return { response: NextResponse.json({ error: "Department not found" }, { status: 404 }) };
    return { supabase: sessionClient(h.db, h.userId), admin: serviceClient(h.db), userId: h.userId, department: { id: dept.id, slug: dept.slug, name: dept.name }, access: {} };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => serviceClient(h.db) }));
vi.mock("@/services/audit", () => ({ createAuditLog: vi.fn(async () => ({ error: null })) }));

const { GET: overview } = await import("./route");
const { GET: listNations, POST: createNation } = await import("./nations/route");
const { GET: getNation, PATCH: patchNation, DELETE: deleteNation } = await import("./nations/[nationId]/route");
const { GET: listTrainings, POST: createTraining } = await import("./trainings/route");
const { GET: getTraining, PATCH: patchTraining, DELETE: deleteTraining } = await import("./trainings/[trainingId]/route");
const { GET: listLeads, POST: createLead } = await import("./leads/route");
const { GET: getLead, PATCH: patchLead, DELETE: deleteLead } = await import("./leads/[leadId]/route");
const { GET: listEvents, POST: addEvent } = await import("./leads/[leadId]/events/route");
const { DELETE: deleteEvent } = await import("./leads/[leadId]/events/[eventId]/route");

type AnyParams = { slug: string; nationId: string; trainingId: string; leadId: string; eventId: string };
const p = (v: Record<string, string> = {}, slug = PW_SLUG) => ({ params: Promise.resolve({ slug, ...v } as AnyParams) });
const send = (body: unknown, method = "POST") => new Request("http://localhost/x", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = (q = "") => new Request(`http://localhost/x${q}`);
const del = () => new Request("http://localhost/x", { method: "DELETE" });
const as = (id: string | null) => (h.userId = id);
const rows = (t: string) => h.db.tables[t] ?? [];

beforeEach(() => {
  h.db = makeWorld();
  as(MEMBER);
});

describe("who gets in", () => {
  it("401 signed out, 403 inactive, 403 (forbidden) for someone outside P&W, 404 another department", async () => {
    as(null);
    expect((await overview(get(), p())).status).toBe(401);
    as(INACTIVE);
    expect((await overview(get(), p())).status).toBe(403);
    as(OUTSIDER);
    const r = await overview(get(), p());
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("forbidden");
    expect((await createLead(send({ label: "x" }), p())).status).toBe(403);
    expect(rows("pw_songwriting_leads")).toHaveLength(2);
    as(MEMBER);
    expect((await overview(get(), p({}, GROUNDS_SLUG))).status).toBe(404);
    expect((await listNations(get(), p({}, "nope"))).status).toBe(404);
  });

  it("an admin outside P&W gets in", async () => {
    as(ADMIN);
    expect((await overview(get(), p())).status).toBe(200);
  });
});

describe("GET /songwriting (SongwritingData for #745)", () => {
  it("answers every key the UI reads, plus owner_name and the viewer", async () => {
    const body = await (await overview(get(), p())).json();
    expect(Object.keys(body).sort()).toEqual(["facilitators", "leads", "librarySongCount", "librarySongsByTraining", "nations", "trainings", "viewer"]);
    expect(body.nations.map((n: { name: string }) => n.name)).toEqual(["England", "Lesotho", "Tanzania"]);
    expect(body.trainings.map((t: { id: string }) => t.id)).toEqual([T_MARCH, T_IMPORTED]);
    expect(body.facilitators).toHaveLength(1);
    const open = body.leads.find((l: { id: string }) => l.id === L_OPEN);
    expect(open.owner_name).toBe("Lera Leader");
    expect(body.leads.find((l: { id: string }) => l.id === L_GROUP).owner_name).toBeNull();
    expect(body.librarySongCount).toBe(3);
    expect(body.librarySongsByTraining).toEqual({ [T_MARCH]: 2 });
    expect(body.viewer).toEqual({ user_id: MEMBER, is_admin: false, is_leader: false, edit_rule: "rls" });
  });

  it("never returns an email", async () => {
    const text = await (await overview(get(), p())).text();
    expect(text).not.toContain("@example.test");
  });
});

describe("nations", () => {
  it("creates with iso_code and languages (cleaned), and lists", async () => {
    const r = await createNation(send({ name: "Kenya", iso_code: "ke", languages: [" Swahili", "swahili", "English"] }), p());
    expect(r.status).toBe(201);
    const { nation } = await r.json();
    expect(nation).toMatchObject({ name: "Kenya", slug: "kenya", iso_code: "KE", languages: ["Swahili", "English"], status: "active" });
    expect((await (await listNations(get(), p())).json()).nations).toHaveLength(4);
    expect((await (await getNation(get(), p({ nationId: nation.id }))).json()).nation.iso_code).toBe("KE");
  });

  it("400 for a bad ISO code (fieldErrors.iso_code); 409 duplicate for a taken one, on create and on patch", async () => {
    const bad = await createNation(send({ name: "Kenya", iso_code: "KEN" }), p());
    expect(bad.status).toBe(400);
    expect((await bad.json()).fieldErrors).toHaveProperty("iso_code");
    const taken = await createNation(send({ name: "Tanzania again", iso_code: "tz" }), p());
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "duplicate", fieldErrors: { iso_code: expect.any(String) } });
    const patch = await patchNation(send({ iso_code: "TZ" }, "PATCH"), p({ nationId: N_EMPTY }));
    expect(patch.status).toBe(409);
    expect((await patch.json()).code).toBe("duplicate");
    const slug = await createNation(send({ name: "Lesotho" }), p());
    expect(await slug.json()).toMatchObject({ code: "duplicate", fieldErrors: { slug: expect.any(String) } });
  });

  it("maps 424's ISO CHECK (23514) to 400 check_failed", async () => {
    const { dbError } = await import("@/lib/songwriting/http");
    const r = dbError({ code: "23514", message: 'new row violates check constraint "pw_nations_iso_code_format"' });
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("check_failed");
  });

  it("patches; 404 for an unknown id", async () => {
    const r = await patchNation(send({ iso_code: "", notes: "Mountain kingdom" }, "PATCH"), p({ nationId: N_EMPTY }));
    expect(await r.json()).toMatchObject({ nation: { iso_code: null, notes: "Mountain kingdom" } });
    expect((await patchNation(send({ notes: "x" }, "PATCH"), p({ nationId: "00000000-0000-4000-8000-00000000ffff" }))).status).toBe(404);
    expect((await getNation(get(), p({ nationId: "nope" }))).status).toBe(404);
  });

  it("refuses to delete a nation that has leads (409 nation_has_leads) or trainings (409 nation_has_trainings); deletes an unused one", async () => {
    const leads = await deleteNation(del(), p({ nationId: N_TZ }));
    expect(leads.status).toBe(409);
    expect((await leads.json()).code).toBe("nation_has_leads");
    const trainings = await deleteNation(del(), p({ nationId: N_TRAINED }));
    expect(trainings.status).toBe(409);
    expect((await trainings.json()).code).toBe("nation_has_trainings");
    const ok = await deleteNation(del(), p({ nationId: N_EMPTY }));
    expect(await ok.json()).toEqual({ deleted: N_EMPTY });
    expect(rows("pw_nations").some((n) => n.id === N_EMPTY)).toBe(false);
  });

  it("a delete the database refuses (23503) is 409 nation_in_use", async () => {
    // A row the API cannot see (or a pw_songs reference) still blocks: the DB is the backstop.
    const { dbError } = await import("@/lib/songwriting/http");
    const r = dbError({ code: "23503", message: "fk" }, { nationDelete: true });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("nation_in_use");
  });
});

describe("trainings", () => {
  const input = {
    audience_label: "Worship leaders",
    year: 2026,
    month: 5,
    location_text: "Arusha",
    nation_id: N_TZ,
    people_trained: 12,
    songs_workshop: 2,
    songs_post: null,
    languages: ["Swahili"],
    notes: null,
    status: "completed",
    facilitators: ["Thandi Member", "Guest Trainer"],
  };

  it("creates from #745's TrainingInput (+ training_date) with facilitators, stamped hub / created_by", async () => {
    const r = await createTraining(send({ ...input, training_date: "2026-05-09" }), p());
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.training).toMatchObject({ year: 2026, month: 5, training_date: "2026-05-09", source: "hub", created_by: MEMBER });
    expect(body.facilitators.map((f: { display_name: string }) => f.display_name)).toEqual(["Guest Trainer", "Thandi Member"]);
    const list = await (await listTrainings(get(), p())).json();
    expect(list.trainings).toHaveLength(3);
    expect(list.facilitators).toHaveLength(3);
  });

  it("400 training_date_outside_month on create", async () => {
    const r = await createTraining(send({ ...input, training_date: "2026-06-01" }), p());
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "training_date_outside_month", fieldErrors: { training_date: expect.any(String) } });
    expect(rows("pw_songwriting_trainings")).toHaveLength(2);
  });

  it("a PATCH moving the month must move or clear the date", async () => {
    const moved = await patchTraining(send({ month: 4 }, "PATCH"), p({ trainingId: T_MARCH }));
    expect(moved.status).toBe(400);
    expect((await moved.json()).code).toBe("training_date_outside_month");
    const cleared = await patchTraining(send({ month: 4, training_date: null }, "PATCH"), p({ trainingId: T_MARCH }));
    expect((await cleared.json()).training).toMatchObject({ month: 4, training_date: null });
    const dated = await patchTraining(send({ month: 5, training_date: "2026-05-02" }, "PATCH"), p({ trainingId: T_MARCH }));
    expect((await dated.json()).training).toMatchObject({ month: 5, training_date: "2026-05-02" });
  });

  it("the database's own month CHECK maps to the same code", async () => {
    const { dbError } = await import("@/lib/songwriting/http");
    const r = dbError({ code: "23514", message: 'new row violates check constraint "pw_songwriting_trainings_date_in_month"' });
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("training_date_outside_month");
  });

  it("PATCH facilitators replaces the list", async () => {
    const r = await patchTraining(send({ facilitators: ["New Person"] }, "PATCH"), p({ trainingId: T_MARCH }));
    const body = await r.json();
    expect(body.facilitators.map((f: { display_name: string }) => f.display_name)).toEqual(["New Person"]);
    expect((await (await getTraining(get(), p({ trainingId: T_MARCH }))).json()).facilitators).toHaveLength(1);
  });

  it("deletes a training: facilitators go, leads keep their row with the source cleared", async () => {
    const r = await deleteTraining(del(), p({ trainingId: T_MARCH }));
    expect(await r.json()).toEqual({ deleted: T_MARCH });
    expect(rows("pw_training_facilitators")).toHaveLength(0);
    expect(rows("pw_songwriting_leads").find((l) => l.id === L_OPEN)!.source_training_id).toBeNull();
    expect((await getTraining(get(), p({ trainingId: T_MARCH }))).status).toBe(404);
  });

  it("an unknown nation is 400 invalid_input", async () => {
    const r = await createTraining(send({ ...input, nation_id: "00000000-0000-4000-8000-00000000ffff" }), p());
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("invalid_input");
  });
});

describe("leads", () => {
  it("creates (created_by is the caller, whatever is sent), with owner_name", async () => {
    const r = await createLead(send({ label: "  Mwanza youth  ", kind: "group", nation_id: N_TZ, owner_user_id: MEMBER2, status: "to_contact" }), p());
    expect(r.status).toBe(201);
    const { lead } = await r.json();
    expect(lead).toMatchObject({ label: "Mwanza youth", kind: "group", created_by: MEMBER, owner_user_id: MEMBER2, owner_name: "Pieter Second", status: "to_contact", last_contact_at: null });
  });

  it("refuses last_contact_at (it comes from logged contacts)", async () => {
    const r = await createLead(send({ label: "x", last_contact_at: "2026-11-01T00:00:00Z" }), p());
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("read_only_field");
  });

  it("lists with filters", async () => {
    const ids = async (q: string) => (await (await listLeads(get(q), p())).json()).leads.map((l: { id: string }) => l.id);
    expect(await ids("")).toEqual([L_OPEN, L_GROUP]);
    expect(await ids("?status=new")).toEqual([L_GROUP]);
    expect(await ids("?status=waiting,closed")).toEqual([L_OPEN]);
    expect(await ids("?kind=organisation")).toEqual([L_GROUP]);
    expect(await ids(`?nation_id=${N_TZ}`)).toEqual([L_OPEN]);
    expect(await ids(`?source_training_id=${T_MARCH}`)).toEqual([L_OPEN]);
    expect(await ids("?owner=none")).toEqual([L_GROUP]);
    expect(await ids(`?owner=${LEADER}`)).toEqual([L_OPEN]);
    as(LEADER);
    expect(await ids("?owner=me")).toEqual([L_OPEN]);
    expect(await ids("?q=WORSHIP")).toEqual([L_OPEN]);
    expect(await ids("?q=100%25")).toEqual([L_GROUP]);
    expect(await ids("?q=1_0")).toEqual([]);
    expect((await listLeads(get("?status=bogus"), p())).status).toBe(400);
  });

  it("gets one lead with its logged contacts (by_name)", async () => {
    const body = await (await getLead(get(), p({ leadId: L_OPEN }))).json();
    expect(body.lead).toMatchObject({ id: L_OPEN, owner_name: "Lera Leader" });
    expect(body.events).toEqual([expect.objectContaining({ id: E_FIRST, by: MEMBER, by_name: "Thandi Member" })]);
    expect((await getLead(get(), p({ leadId: "00000000-0000-4000-8000-00000000ffff" }))).status).toBe(404);
  });

  it("patches status and owner; refuses created_by", async () => {
    const r = await patchLead(send({ status: "connected", owner_user_id: null }, "PATCH"), p({ leadId: L_OPEN }));
    expect((await r.json()).lead).toMatchObject({ status: "connected", owner_user_id: null, owner_name: null });
    expect((await patchLead(send({ created_by: MEMBER2 }, "PATCH"), p({ leadId: L_OPEN }))).status).toBe(400);
  });

  it("deletes a lead and its logged contacts", async () => {
    expect(await (await deleteLead(del(), p({ leadId: L_OPEN }))).json()).toEqual({ deleted: L_OPEN });
    expect(rows("pw_songwriting_lead_events")).toHaveLength(0);
  });
});

describe("logged contacts", () => {
  it("POST { note } answers { lead, event } with last_contact_at moved forward (#745's logContact)", async () => {
    as(MEMBER2);
    const r = await addEvent(send({ note: "Visited the choir" }), p({ leadId: L_GROUP }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.event).toMatchObject({ lead_id: L_GROUP, by: MEMBER2, by_name: "Pieter Second", note: "Visited the choir" });
    expect(body.lead.id).toBe(L_GROUP);
    expect(body.lead.last_contact_at).toBe(body.event.at);
  });

  it("an older back-dated contact does not move last_contact_at back", async () => {
    const r = await addEvent(send({ note: "Earlier call", at: "2026-10-01T10:00:00Z" }), p({ leadId: L_OPEN }));
    expect((await r.json()).lead.last_contact_at).toBe("2026-11-02T09:00:00.000Z");
  });

  it("lists newest first; 404 for an unknown lead", async () => {
    await addEvent(send({ note: "Second", at: "2026-11-10T10:00:00Z" }), p({ leadId: L_OPEN }));
    const { events } = await (await listEvents(get(), p({ leadId: L_OPEN }))).json();
    expect(events.map((e: { note: string }) => e.note)).toEqual(["Second", "Called the pastor"]);
    expect((await addEvent(send({ note: "x" }), p({ leadId: "00000000-0000-4000-8000-00000000ffff" }))).status).toBe(404);
  });

  it("only the person who logged it, or an admin, can delete it; last_contact_at is recomputed", async () => {
    as(MEMBER2);
    const refused = await deleteEvent(del(), p({ leadId: L_OPEN, eventId: E_FIRST }));
    expect(refused.status).toBe(403);
    as(LEADER);
    expect((await deleteEvent(del(), p({ leadId: L_OPEN, eventId: E_FIRST }))).status).toBe(403);
    as(MEMBER);
    const ok = await (await deleteEvent(del(), p({ leadId: L_OPEN, eventId: E_FIRST }))).json();
    expect(ok.lead.last_contact_at).toBeNull();
    as(MEMBER2);
    const mine = await (await addEvent(send({ note: "x" }), p({ leadId: L_OPEN }))).json();
    as(ADMIN);
    expect((await deleteEvent(del(), p({ leadId: L_OPEN, eventId: mine.event.id }))).status).toBe(200);
  });
});

describe("edit and delete go through canEditSongwritingRecord", () => {
  it("today any P&W member may edit or delete records someone else made (what RLS allows)", async () => {
    as(MEMBER2); // L_OPEN and T_MARCH were made by MEMBER
    expect((await patchLead(send({ note: "x" }, "PATCH"), p({ leadId: L_OPEN }))).status).toBe(200);
    expect((await patchTraining(send({ notes: "x" }, "PATCH"), p({ trainingId: T_MARCH }))).status).toBe(200);
    expect((await patchNation(send({ notes: "x" }, "PATCH"), p({ nationId: N_TZ }))).status).toBe(200);
    expect((await deleteLead(del(), p({ leadId: L_OPEN }))).status).toBe(200);
  });

  it("when the helper refuses, the API answers 403 forbidden and writes nothing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/songwriting/access", async (orig) => {
      const real = await orig<typeof import("@/lib/songwriting/access")>();
      return { ...real, canEditSongwritingRecord: (v: Parameters<typeof real.canEditSongwritingRecord>[0], r: Parameters<typeof real.canEditSongwritingRecord>[1]) => real.canEditSongwritingRecord(v, r, "creator_leaders_admins") };
    });
    const narrowed = await import("./leads/[leadId]/route");
    const narrowedTraining = await import("./trainings/[trainingId]/route");
    as(MEMBER2);
    const r = await narrowed.PATCH(send({ note: "x" }, "PATCH"), p({ leadId: L_OPEN }));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("forbidden");
    expect((await narrowed.DELETE(del(), p({ leadId: L_OPEN }))).status).toBe(403);
    expect((await narrowedTraining.DELETE(del(), p({ trainingId: T_MARCH }))).status).toBe(403);
    expect(rows("pw_songwriting_leads").find((l) => l.id === L_OPEN)!.note).toBeNull();
    as(MEMBER);
    expect((await narrowed.PATCH(send({ note: "mine" }, "PATCH"), p({ leadId: L_OPEN }))).status).toBe(200);
    as(LEADER);
    expect((await narrowed.PATCH(send({ note: "leader" }, "PATCH"), p({ leadId: L_GROUP }))).status).toBe(200);
    vi.doUnmock("@/lib/songwriting/access");
  });
});
