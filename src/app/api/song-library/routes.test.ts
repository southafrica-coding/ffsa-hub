import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN,
  BASE,
  COWRITER,
  DEMO_SONG,
  HELP,
  MEDIA_ID,
  MEDIA_LEAD,
  PW_ID,
  PW_LEADER,
  PW_MEMBER,
  SONG,
  SUB_ALL,
  SUB_WRITER,
  V1,
  W_CO,
  W_GUEST,
  W_DEMO as W_DEMO_OTHER,
  W_LEAD,
  WRITER,
  agreeAll,
  makeSongWorld,
  type SongWorld,
} from "@/lib/song-library/testing/world";

const INACTIVE = "00000000-0000-4000-8000-00000000c0ff";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as unknown as SongWorld,
  dms: [] as { to: string; text: string }[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db.client({ userId: h.userId, rls: h.db.rls }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => (h.userId ? { id: h.userId } : null) }));
vi.mock("@/lib/auth/grant-scope", () => ({ accountIsActive: async (_s: unknown, id: string) => id !== INACTIVE }));
vi.mock("@/lib/slack/bots", () => ({ isBotConfigured: () => true }));
vi.mock("@/lib/slack/client", () => ({
  openConversation: vi.fn(async (id: string) => ({ ok: true, channel: { id: `D_${id}` } })),
  postMessage: vi.fn(async (args: { channel: string; text: string }) => {
    h.dms.push({ to: args.channel, text: args.text });
    return { ok: true, ts: "1.0" };
  }),
}));

const songs = await import("./songs/route");
const song = await import("./songs/[songId]/route");
const stage = await import("./songs/[songId]/stage/route");
const placement = await import("./songs/[songId]/placement/route");
const uploads = await import("./songs/[songId]/uploads/route");
const versions = await import("./songs/[songId]/versions/route");
const audio = await import("./songs/[songId]/versions/[versionId]/audio/route");
const writers = await import("./songs/[songId]/writers/route");
const writer = await import("./songs/[songId]/writers/[writerId]/route");
const confirm = await import("./songs/[songId]/writers/[writerId]/confirm/route");
const splits = await import("./songs/[songId]/splits/route");
const publishing = await import("./songs/[songId]/publishing/route");
const celebrate = await import("./songs/[songId]/celebrate/route");
const celebrateOne = await import("./songs/[songId]/celebrate/[promptNo]/route");
const songHelp = await import("./songs/[songId]/help-requests/route");
const help = await import("./help-requests/route");
const helpOne = await import("./help-requests/[requestId]/route");
const signup = await import("./help-requests/[requestId]/signups/route");
const helpersMe = await import("./helpers/me/route");
const subs = await import("./subscriptions/route");
const subOne = await import("./subscriptions/[subscriptionId]/route");
const writerProfile = await import("./writers/[userId]/route");
const home = await import("./route");
const boardRoute = await import("./board/route");
const refineRoute = await import("./songs/[songId]/refine/[q]/route");
const pathwayRoute = await import("./songs/[songId]/pathway/[step]/route");
const shareRoute = await import("./songs/[songId]/share/[kind]/route");
const checkpointRoute = await import("./songs/[songId]/checkpoints/[kind]/route");
const helpers = await import("./helpers/route");
const helperOne = await import("./helpers/[category]/route");
const audioById = await import("./versions/[versionId]/audio/route");

const req = (body?: unknown, method = "POST") =>
  new Request("http://localhost/x", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const get = (q = "") => new Request(`http://localhost/x${q}`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = (v: Record<string, string>): any => ({ params: Promise.resolve(v) });
const S = (extra: Record<string, string> = {}) => p({ songId: SONG, ...extra });
const as = (uid: string | null) => {
  h.userId = uid;
};
const songRow = (id = SONG) => h.db.raw("song_library_songs").find((s) => s.id === id)!;
const songUpdatesBy = (uid: string) => h.db.log.filter((l) => l.table === "song_library_songs" && l.action === "update" && l.uid === uid);
const code = async (r: Response) => ((await r.json()) as { code?: string }).code;
/** [code, reason] of a refusal. */
const why = async (r: Response) => {
  const b = (await r.json()) as { code?: string; reason?: string };
  return [b.code, b.reason];
};

beforeEach(() => {
  h.db = makeSongWorld();
  h.dms = [];
  as(BASE);
});
afterEach(() => vi.unstubAllEnvs());

describe("who gets in", () => {
  it("refuses someone signed out (401) or inactive (403)", async () => {
    as(null);
    const out = await songs.GET(get());
    expect(out.status).toBe(401);
    expect(await code(out)).toBe("unauthenticated");
    as(INACTIVE);
    expect((await songs.GET(get())).status).toBe(403);
    expect((await song.GET(get(), S())).status).toBe(403);
  });

  it("shows every song to anyone on the base", async () => {
    const list = await (await songs.GET(get())).json();
    type Item = { song: { id: string; title: string }; writers: { userId: string | null; name: string }[]; status: { splits_agreed: boolean } | null };
    expect(list.songs.map((s: Item) => s.song.title).sort()).toEqual(["Harbour Lights", "Mercy Like Morning"]);
    const item = list.songs.find((s: Item) => s.song.id === SONG) as Item;
    expect(item.writers).toEqual([{ userId: WRITER, name: "Dani Blood" }, { userId: COWRITER, name: "Noah Lind" }, { userId: null, name: "Guest Writer" }]);
    expect(item.status).toMatchObject({ splits_agreed: false });
    const finished = await (await songs.GET(get("?bucket=finished"))).json();
    expect(finished.songs.map((s: Item) => s.song.id)).toEqual([DEMO_SONG]);
    const detail = await song.GET(get(), S());
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.song.title).toBe("Harbour Lights");
    expect(body).toMatchObject({ viewerIsWriter: false, viewerFollowsLead: false });
    expect(body.viewer).toMatchObject({ isWriter: false, canEdit: false, canSetPlacement: false, canEditPublishing: false, canTickRefine: false, allowedStages: [] });
  });
});

describe("celebrate notes", () => {
  it("are left out for anyone who is not a writer or in P&W", async () => {
    for (const uid of [BASE, MEDIA_LEAD, SUB_ALL]) {
      as(uid);
      const body = await (await song.GET(get(), S())).json();
      expect(body).not.toHaveProperty("celebrateNotes");
      expect(JSON.stringify(body)).not.toContain("prayer night");
      expect((await celebrate.GET(get(), S())).status).toBe(403);
    }
  });

  it("are shown to the song's writers, P&W members and admins", async () => {
    for (const uid of [WRITER, COWRITER, PW_MEMBER, PW_LEADER, ADMIN]) {
      as(uid);
      const body = await (await song.GET(get(), S())).json();
      expect(body.celebrateNotes).toHaveLength(1);
      expect((await celebrate.GET(get(), S())).status).toBe(200);
    }
  });

  it("are written by the song's writers only", async () => {
    as(COWRITER);
    expect((await celebrateOne.PUT(req({ body: "Sung at the noon set" }, "PUT"), S({ promptNo: "2" }))).status).toBe(200);
    as(PW_MEMBER);
    expect(await why(await celebrateOne.PUT(req({ body: "x" }, "PUT"), S({ promptNo: "3" })))).toEqual(["forbidden", "not_writer"]);
    as(BASE);
    expect((await celebrateOne.DELETE(get(), S({ promptNo: "1" }))).status).toBe(403);
    expect(h.db.raw("song_library_celebrate_notes")).toHaveLength(2);
  });
});

describe("uploading a song", () => {
  it("lets anyone upload; they become the lead writer at idea_entry, with co-writers", async () => {
    const r = await songs.POST(req({ title: "Lanterns", entry_point: "lyric", co_writers: [{ user_id: COWRITER, role: "Melody" }, { display_name: "Gran" }] }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.song).toMatchObject({ created_by: BASE, stage: "idea_entry", placement: "inbox", visibility: "base" });
    expect(body.writers.map((w: { user_id: string | null; is_lead: boolean }) => [w.user_id, w.is_lead])).toEqual([[BASE, true], [COWRITER, false], [null, false]]);
    expect(h.db.raw("song_library_stage_events").some((e) => e.song_id === body.song.id && e.kind === "stage")).toBe(true);
  });

  it("validates the body", async () => {
    expect((await songs.POST(req({ entry_point: "lyric" }))).status).toBe(400);
    expect((await songs.POST(req({ title: "x", entry_point: "drums" }))).status).toBe(400);
    expect((await songs.POST(req({ title: "x", entry_point: "lyric", stage: "celebrate" }))).status).toBe(400);
  });
});

describe("stage moves", () => {
  it("lets a writer skip ahead within the early stages, with a stage event and note", async () => {
    as(COWRITER);
    const r = await stage.POST(req({ to: "refine", from: "writing", note: "Melody done" }), S());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.song.stage).toBe("refine");
    expect(body.event).toMatchObject({ kind: "stage", from_stage: "writing", to_stage: "refine", by_user: COWRITER, note: "Melody done" });
    as(WRITER);
    expect((await stage.POST(req({ to: "written_needs_demo" }), S())).status).toBe(200);
    expect((await stage.POST(req({ to: "idea_entry" }), S())).status).toBe(200);
  });

  it("stops a writer moving into or out of demo_ready, share or celebrate, before the database", async () => {
    as(WRITER);
    songRow().stage = "written_needs_demo";
    const r = await stage.POST(req({ to: "demo_ready" }), S());
    expect(r.status).toBe(403);
    expect(await code(r)).toBe("stage_not_allowed");
    expect((await stage.POST(req({ to: "writing" }), p({ songId: DEMO_SONG }))).status).toBe(403);
    expect((await stage.POST(req({ to: "celebrate" }), p({ songId: DEMO_SONG }))).status).toBe(403);
    expect(songUpdatesBy(WRITER)).toHaveLength(0);
    expect(songRow().stage).toBe("written_needs_demo");
  });

  it("refuses someone who neither writes the song nor is in P&W", async () => {
    for (const uid of [BASE, MEDIA_LEAD]) {
      as(uid);
      expect(await code(await stage.POST(req({ to: "set_down" }), S()))).toBe("stage_not_allowed");
    }
    expect(songRow().stage).toBe("writing");
  });

  it("lets any P&W member make any move, both ways", async () => {
    as(PW_MEMBER);
    expect((await stage.POST(req({ to: "celebrate" }), S())).status).toBe(200);
    expect((await stage.POST(req({ to: "writing" }), p({ songId: DEMO_SONG }))).status).toBe(200);
    expect(songRow().stage).toBe("celebrate");
    expect(songRow(DEMO_SONG).stage).toBe("writing");
    const events = h.db.raw("song_library_stage_events").filter((e) => e.kind === "stage" && e.by_user === PW_MEMBER);
    expect(events.map((e) => [e.from_stage, e.to_stage])).toEqual([["writing", "celebrate"], ["demo_ready", "writing"]]);
  });

  it("answers 409 when the song moved since the caller looked", async () => {
    as(PW_MEMBER);
    const r = await stage.POST(req({ to: "share", from: "refine" }), S());
    expect(r.status).toBe(409);
    expect(await code(r)).toBe("song_moved");
  });
});

describe("placement", () => {
  it("is set by P&W members only, and logged", async () => {
    as(WRITER);
    const r = await placement.POST(req({ to: "prayer_sets" }), S());
    expect(r.status).toBe(403);
    expect(await why(r)).toEqual(["forbidden", "placement_not_allowed"]);
    as(BASE);
    expect((await placement.POST(req({ to: "prayer_sets" }), S())).status).toBe(403);
    as(PW_MEMBER);
    const ok = await placement.POST(req({ to: "ministry_nights", note: "Noon set" }), S());
    expect(ok.status).toBe(200);
    expect((await ok.json()).event).toMatchObject({ kind: "placement", payload: { from: "inbox", to: "ministry_nights" }, note: "Noon set" });
    expect((await placement.POST(req({ to: "nowhere" }), S())).status).toBe(400);
  });
});

describe("editing and deleting", () => {
  it("lets writers edit, not P&W members or others; stage goes through /stage", async () => {
    as(COWRITER);
    expect((await song.PATCH(req({ title: "Harbour Lights (v2)", bpm: 72 }, "PATCH"), S())).status).toBe(200);
    expect(songRow().title).toBe("Harbour Lights (v2)");
    as(PW_MEMBER);
    expect(await why(await song.PATCH(req({ title: "x" }, "PATCH"), S()))).toEqual(["forbidden", "not_writer"]);
    as(BASE);
    expect((await song.PATCH(req({ title: "x" }, "PATCH"), S())).status).toBe(403);
    as(WRITER);
    expect((await song.PATCH(req({ stage: "refine" }, "PATCH"), S())).status).toBe(400);
  });

  it("lets only the lead writer (or an admin) delete", async () => {
    as(COWRITER);
    expect(await why(await song.DELETE(get(), S()))).toEqual(["forbidden", "not_lead_writer"]);
    as(PW_LEADER);
    expect((await song.DELETE(get(), S())).status).toBe(403);
    as(WRITER);
    expect((await song.DELETE(get(), S())).status).toBe(200);
    expect(h.db.raw("song_library_songs").some((s) => s.id === SONG)).toBe(false);
  });
});

describe("publishing", () => {
  const pub = { ccli_no: "7654321", publisher: "FFSA Music", pro_by_writer: { [W_LEAD]: { pro: "SAMRO", member_no: "123" } } };
  it("is edited by the song's writers, any P&W member and admins (as 419)", async () => {
    for (const uid of [WRITER, COWRITER, PW_MEMBER, PW_LEADER, ADMIN]) {
      as(uid);
      expect((await publishing.PUT(req(pub, "PUT"), S())).status).toBe(200);
    }
    for (const uid of [BASE, MEDIA_LEAD, SUB_ALL]) {
      as(uid);
      expect(await why(await publishing.PUT(req(pub, "PUT"), S()))).toEqual(["forbidden", "publishing_not_allowed"]);
    }
    expect(h.db.raw("song_library_publishing")).toHaveLength(1);
  });

  it("validates CCLI numbers and keys pro_by_writer by this song's writers", async () => {
    as(WRITER);
    expect((await publishing.PUT(req({ ccli_no: "12-34" }, "PUT"), S())).status).toBe(400);
    expect((await publishing.PUT(req({ pro_by_writer: { [W_DEMO_OTHER]: { pro: "x" } } }, "PUT"), S())).status).toBe(400);
  });

  it("follows the service grants, not a department name", async () => {
    for (const g of h.db.raw("service_owners")) if (g.staff_ministry_id === PW_ID) g.staff_ministry_id = MEDIA_ID;
    as(MEDIA_LEAD);
    expect((await publishing.PUT(req(pub, "PUT"), S())).status).toBe(200);
    expect((await placement.POST(req({ to: "events" }), S())).status).toBe(200);
    as(PW_LEADER);
    expect((await publishing.PUT(req(pub, "PUT"), S())).status).toBe(403);
    expect((await placement.POST(req({ to: "inbox" }), S())).status).toBe(403);
  });
});

describe("splits", () => {
  const set = (lead: number, co: number, guest: number) => ({ splits: [{ writer_id: W_LEAD, split_pct: lead }, { writer_id: W_CO, split_pct: co }, { writer_id: W_GUEST, split_pct: guest }] });

  it("must total 100, cover every writer and name only writers", async () => {
    as(WRITER);
    const r = await splits.PUT(req(set(50, 40, 5), "PUT"), S());
    expect(r.status).toBe(400);
    expect(await code(r)).toBe("splits_not_100");
    expect((await splits.PUT(req({ splits: [{ writer_id: W_LEAD, split_pct: 60 }, { writer_id: W_CO, split_pct: 40 }] }, "PUT"), S())).status).toBe(400);
    expect((await splits.PUT(req({ splits: [...set(50, 40, 10).splits, { writer_id: W_DEMO_OTHER, split_pct: 0 }] }, "PUT"), S())).status).toBe(400);
    const ok = await splits.PUT(req(set(45.5, 44.5, 10), "PUT"), S());
    expect(ok.status).toBe(200);
    expect((await ok.json()).splits).toMatchObject({ total_pct: 100, complete: true, agreed: false });
  });

  it("are set by writers only", async () => {
    for (const uid of [PW_MEMBER, BASE]) {
      as(uid);
      expect(await why(await splits.PUT(req(set(50, 40, 10), "PUT"), S()))).toEqual(["forbidden", "not_writer"]);
      expect((await writers.POST(req({ display_name: "Someone" }), S())).status).toBe(403);
    }
  });

  it("cannot be signed off until they total 100", async () => {
    h.db.raw("song_library_writers").find((w) => w.id === W_CO)!.split_pct = 35;
    as(WRITER);
    const r = await confirm.POST(req(), S({ writerId: W_LEAD }));
    expect(r.status).toBe(400);
    expect(await code(r)).toBe("splits_not_100");
  });

  it("each writer signs off their own; P&W signs for a writer with no account; then they lock", async () => {
    as(WRITER);
    expect(await why(await confirm.POST(req(), S({ writerId: W_CO })))).toEqual(["forbidden", "confirm_not_allowed"]);
    expect(await why(await confirm.POST(req(), S({ writerId: W_GUEST })))).toEqual(["forbidden", "confirm_not_allowed"]);
    expect((await confirm.POST(req(), S({ writerId: W_LEAD }))).status).toBe(200);
    as(PW_MEMBER);
    expect(await why(await confirm.POST(req(), S({ writerId: W_CO })))).toEqual(["forbidden", "confirm_not_allowed"]);
    expect((await confirm.POST(req(), S({ writerId: W_GUEST }))).status).toBe(200);
    as(COWRITER);
    const last = await (await confirm.POST(req(), S({ writerId: W_CO }))).json();
    expect(last.splits).toMatchObject({ agreed: true, confirmed: 3, writers: 3 });
    expect(h.db.agreed(SONG)).toBe(true);
    expect(h.db.raw("song_library_checkpoints").find((c) => c.kind === "credits_splits_agreed")?.done_at).toBeTruthy();

    // Locked: no credit change by anyone, and a writer cannot withdraw.
    as(WRITER);
    for (const r of [
      await splits.PUT(req(set(40, 50, 10), "PUT"), S()),
      await writers.POST(req({ display_name: "Late" }), S()),
      await writer.PATCH(req({ split_pct: 10 }, "PATCH"), S({ writerId: W_GUEST })),
      await writer.DELETE(get(), S({ writerId: W_GUEST })),
      await confirm.DELETE(get(), S({ writerId: W_LEAD })),
    ]) {
      expect(r.status).toBe(409);
      expect(await code(r)).toBe("credits_agreed");
    }
    expect(h.db.raw("song_library_writers").find((w) => w.id === W_LEAD)!.split_pct).toBe(50);

    // A manager can revoke; every sign-off is cleared.
    as(PW_MEMBER);
    const revoked = await (await confirm.DELETE(get(), S({ writerId: W_CO }))).json();
    expect(revoked.splits).toMatchObject({ agreed: false, confirmed: 0 });
  });

  it("are locked by the database too (419 refuses a credit change while agreed)", async () => {
    agreeAll(h.db, SONG);
    const session = h.db.client({ userId: WRITER, rls: h.db.rls }) as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: string) => Promise<{ error: { code: string } | null }> } } };
    const r = await session.from("song_library_writers").update({ split_pct: 60 }).eq("id", W_LEAD);
    expect(r.error?.code).toBe("23514");
  });

  it("clear every sign-off when a split changes before agreement", async () => {
    as(WRITER);
    await confirm.POST(req(), S({ writerId: W_LEAD }));
    expect(h.db.raw("song_library_writers").find((w) => w.id === W_LEAD)!.confirmed_at).toBeTruthy();
    await splits.PUT(req(set(60, 30, 10), "PUT"), S());
    expect(h.db.raw("song_library_writers").filter((w) => w.song_id === SONG).every((w) => !w.confirmed_at)).toBe(true);
  });
});

describe("help", () => {
  it("is asked for by the song's writers or P&W", async () => {
    as(BASE);
    expect((await songHelp.POST(req({ categories: ["keys"], body: "Need keys" }), S())).status).toBe(403);
    as(COWRITER);
    expect((await songHelp.POST(req({ categories: ["keys"], body: "Need keys" }), S())).status).toBe(201);
    as(PW_MEMBER);
    expect((await songHelp.POST(req({ categories: ["vocals", "vocals"], body: "Harmony" }), S())).status).toBe(201);
    expect((await songHelp.POST(req({ categories: ["tuba"], body: "x" }), S())).status).toBe(400);
  });

  it("takes sign-ups while open, once each, and is managed by whoever asked or P&W", async () => {
    as(BASE);
    expect((await signup.POST(req({ note: "I play bass" }), p({ requestId: HELP }))).status).toBe(201);
    const again = await signup.POST(req(), p({ requestId: HELP }));
    expect(again.status).toBe(200);
    expect((await again.json()).already).toBe(true);
    const list = await (await help.GET(get())).json();
    expect(list.helpRequests[0]).toMatchObject({ viewerSignedUp: true, songTitle: "Harbour Lights", askedByName: "Dani Blood" });
    expect((await helpOne.PATCH(req({ status: "closed" }, "PATCH"), p({ requestId: HELP }))).status).toBe(403);
    as(WRITER);
    expect((await helpOne.PATCH(req({ status: "filled", helper_user_id: BASE }, "PATCH"), p({ requestId: HELP }))).status).toBe(200);
    as(SUB_ALL);
    const closed = await signup.POST(req(), p({ requestId: HELP }));
    expect(closed.status).toBe(409);
    expect(await code(closed)).toBe("help_closed");
    as(PW_MEMBER);
    expect((await helpOne.DELETE(get(), p({ requestId: HELP }))).status).toBe(200);
  });

  it("lets each person set their own helper categories", async () => {
    as(SUB_ALL);
    const r = await helpersMe.PUT(req({ categories: ["keys", { category: "vocals", note: "alto" }] }, "PUT"));
    expect((await r.json()).mine).toEqual([{ category: "keys", note: null }, { category: "vocals", note: "alto" }]);
    await helpersMe.PUT(req({ categories: ["vocals"] }, "PUT"));
    expect(h.db.raw("song_library_helpers").filter((x) => x.user_id === SUB_ALL).map((x) => x.category)).toEqual(["vocals"]);
    expect(h.db.raw("song_library_helpers").some((x) => x.user_id === BASE)).toBe(true);
  });
});

describe("subscriptions", () => {
  it("are private, idempotent, and never to yourself", async () => {
    as(SUB_WRITER);
    const mine = await (await subs.GET()).json();
    expect(mine.subscriptions.map((s: { user_id: string }) => s.user_id)).toEqual([SUB_WRITER, SUB_WRITER]);
    expect(mine.subscribedAllUploads).toBe(true);
    const r = await subs.POST(req({ target_type: "writer", target_user_id: WRITER }));
    expect(r.status).toBe(201);
    const again = await subs.POST(req({ target_type: "writer", target_user_id: WRITER }));
    expect((await again.json()).already).toBe(true);
    expect((await subs.POST(req({ target_type: "writer", target_user_id: SUB_WRITER }))).status).toBe(400);
    expect((await subOne.DELETE(get(), p({ subscriptionId: "00000000-0000-4000-8000-0000000000aa" }))).status).toBe(404);
    const profile = await (await writerProfile.GET(get(), p({ userId: WRITER }))).json();
    expect(profile).toMatchObject({ subscriberCount: 1, person: { userId: WRITER, name: "Dani Blood" }, viewerSubscribed: true, isSelf: false });
    expect(profile.written.map((i: { song: { id: string } }) => i.song.id)).toContain(SONG);
    expect(profile.coWritten).toEqual([]);
    expect(profile.subscriptionId).toBeTruthy();
  });
});

describe("audio upload and subscriber DMs", () => {
  async function upload(songId: string) {
    const signed = await uploads.POST(req({ filename: "idea.mp3", content_type: "audio/mpeg", size: 1234 }), p({ songId }));
    expect(signed.status).toBe(200);
    const { path, bucket, token } = await signed.json();
    expect(bucket).toBe("song-library");
    expect(token).toBeTruthy();
    expect(path.startsWith(`${songId}/v-`)).toBe(true);
    return path as string;
  }

  it("is for the song's writers only", async () => {
    for (const uid of [BASE, PW_MEMBER]) {
      as(uid);
      expect((await uploads.POST(req({ filename: "a.mp3", content_type: "audio/mpeg", size: 10 }), S())).status).toBe(403);
      expect((await versions.POST(req({ path: `${SONG}/v-00000000-0000-4000-8000-000000000009.mp3` }), S())).status).toBe(403);
    }
    as(WRITER);
    expect((await uploads.POST(req({ filename: "a.exe", content_type: "application/x-msdownload", size: 10 }), S())).status).toBe(400);
    expect((await uploads.POST(req({ filename: "a.wav", content_type: "audio/wav", size: 300 * 1024 * 1024 }), S())).status).toBe(413);
  });

  it("records a version only once the file is there, and refuses paths for another song", async () => {
    as(WRITER);
    const path = await upload(SONG);
    const missing = await versions.POST(req({ path }), S());
    expect(await code(missing)).toBe("upload_missing");
    expect((await versions.POST(req({ path: path.replace(SONG, DEMO_SONG) }), S())).status).toBe(400);
    h.db.objects.set(path, 1234);
    const r = await versions.POST(req({ path, label: "Bridge idea" }), S());
    expect(r.status).toBe(201);
    expect((await r.json()).version).toMatchObject({ n: 2, uploaded_by: WRITER, size_bytes: 1234, mime_type: "audio/mpeg" });
  });

  it("DMs every subscriber once for a new song, on production only", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    as(BASE);
    const created = await (await songs.POST(req({ title: "New One", entry_point: "melody", co_writers: [{ user_id: COWRITER }] }))).json();
    const id = created.song.id as string;
    const path = await upload(id);
    h.db.objects.set(path, 999);
    const r = await (await versions.POST(req({ path }), p({ songId: id }))).json();
    expect(r.notified).toMatchObject({ outcome: "done", kind: "new_upload", sent: 3 });
    expect(h.dms.map((d) => d.to).sort()).toEqual(["D_U_SUB_ALL", "D_U_SUB_WRITER", "D_U_WRITER"]);
    expect(h.dms[0].text).toContain(`/song-library/songs/${id}`);
  });

  it("sends nothing off production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    as(BASE);
    const created = await (await songs.POST(req({ title: "Quiet", entry_point: "lyric" }))).json();
    const path = await upload(created.song.id);
    h.db.objects.set(path, 5);
    const r = await (await versions.POST(req({ path }), p({ songId: created.song.id }))).json();
    expect(r.notified.outcome).toBe("off");
    expect(h.dms).toHaveLength(0);
    expect(h.db.raw("song_library_notifications")).toHaveLength(0);
  });

  it("gives any reader a short-lived audio link", async () => {
    h.db.objects.set(h.db.raw("song_library_versions")[0]!.storage_path as string, 1000);
    const r = await audio.GET(get(), S({ versionId: V1 }));
    expect(r.status).toBe(200);
    expect((await r.json()).expires_in).toBe(600);
  });
});

describe("Hub UI's client contract (#745)", () => {
  it("GET /api/song-library is LibraryHome", async () => {
    as(SUB_ALL);
    const r = await (await home.GET()).json();
    expect(r.subscribedAllUploads).toBe(true);
    expect(r.songs).toHaveLength(2);
    expect(r.songs[0]).toHaveProperty("song.id");
    as(BASE);
    expect((await (await home.GET()).json()).subscribedAllUploads).toBe(false);
  });

  it("GET /board is a bare SongListItem[] for managers only", async () => {
    as(PW_MEMBER);
    const r = await boardRoute.GET();
    expect(r.status).toBe(200);
    const items = await r.json();
    expect(Array.isArray(items)).toBe(true);
    expect(items.map((i: { song: { id: string } }) => i.song.id).sort()).toEqual([SONG, DEMO_SONG].sort());
    as(BASE);
    expect(await why(await boardRoute.GET())).toEqual(["forbidden", "not_manager"]);
  });

  it("GET /songs/:id is SongDetail", async () => {
    as(SUB_WRITER);
    const d = await (await song.GET(get(), S())).json();
    for (const k of ["song", "versions", "pathwaySteps", "events", "refine", "writers", "publishing", "checkpoints", "helpRequests", "status", "viewerIsWriter", "viewerFollowsLead"]) expect(d).toHaveProperty(k);
    expect(d.viewerFollowsLead).toBe(false);
    expect(d.writers[0]).toMatchObject({ is_lead: true, name: "Dani Blood" });
    as(PW_MEMBER);
    await placement.POST(req({ to: "prayer_sets" }), S());
    as(SUB_WRITER);
    const moved = await (await song.GET(get(), S())).json();
    expect(moved.events.find((e: { kind: string }) => e.kind === "placement")).toMatchObject({ byName: expect.any(String) });
    expect(d.helpRequests[0]).toMatchObject({ askedByName: "Dani Blood", helperName: null });
    await subs.POST(req({ target_type: "writer", target_user_id: WRITER }));
    expect((await (await song.GET(get(), S())).json()).viewerFollowsLead).toBe(true);
    as(WRITER);
    expect((await (await song.GET(get(), S())).json()).viewerIsWriter).toBe(true);
  });

  it("takes co-writers as plain names, once each", async () => {
    const r = await songs.POST(req({ title: "Names", entry_point: "lyric", pathway: "b1", holy_spirit_interrupt: false, lyrics_md: null, source_training_id: null, co_writers: ["Gran", "Gran", "Sipho"] }));
    expect(r.status).toBe(201);
    const names = (await r.json()).writers.map((w: { name: string; user_id: string | null }) => [w.user_id, w.name]);
    expect(names.slice(1)).toEqual([[null, "Gran"], [null, "Sipho"]]);
    expect(names[0][0]).toBe(BASE);
  });

  it("answers invalid_input with fieldErrors the form can highlight", async () => {
    const r = await songs.POST(req({ entry_point: "lyric" }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.code).toBe("invalid_input");
    expect(Object.keys(b.fieldErrors)).toEqual(["title"]);
  });

  it("refuses multipart audio: upload to the signed URL instead", async () => {
    as(WRITER);
    const form = new FormData();
    form.append("file", new Blob(["x"], { type: "audio/mpeg" }), "a.mp3");
    const r = await versions.POST(new Request("http://localhost/x", { method: "POST", body: form }), S());
    expect(r.status).toBe(415);
    expect(await code(r)).toBe("use_signed_upload");
    const big = await uploads.POST(req({ filename: "a.wav", content_type: "audio/wav", size: 300 * 1024 * 1024 }), S());
    expect(big.status).toBe(413);
    expect(await code(big)).toBe("too_large");
  });

  it("GET /versions/:vid/audio redirects to a short-lived signed URL", async () => {
    h.db.objects.set(h.db.raw("song_library_versions").find((v) => v.id === V1)!.storage_path as string, 1000);
    const r = await audioById.GET(get(), p({ versionId: V1 }));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain("https://storage.test/read/song-library/");
    as(null);
    expect((await audioById.GET(get(), p({ versionId: V1 }))).status).toBe(401);
  });

  it("PUT /refine/:q is for the song's writers (419), not P&W members", async () => {
    as(WRITER);
    const r = await refineRoute.PUT(req({ checked: true, note: "Flows" }, "PUT"), S({ q: "3" }));
    expect(r.status).toBe(200);
    expect((await r.json()).item).toMatchObject({ q_no: 3, checked: true, note: "Flows", by_user: WRITER });
    expect((await refineRoute.PUT(req({ checked: false }, "PUT"), S({ q: "3" }))).status).toBe(200);
    expect(h.db.raw("song_library_refine_items")).toHaveLength(1);
    expect((await refineRoute.PUT(req({ checked: true }, "PUT"), S({ q: "12" }))).status).toBe(400);
    as(PW_MEMBER);
    expect(await why(await refineRoute.PUT(req({ checked: true }, "PUT"), S({ q: "11" })))).toEqual(["forbidden", "not_writer"]);
  });

  it("pathway and share steps are ticked by writers, idempotently", async () => {
    as(COWRITER);
    await pathwayRoute.PUT(get(), S({ step: "melody" }));
    const again = await (await pathwayRoute.PUT(get(), S({ step: "melody" }))).json();
    expect(again.pathwaySteps).toHaveLength(1);
    expect((await (await pathwayRoute.DELETE(get(), S({ step: "melody" }))).json()).pathwaySteps).toHaveLength(0);
    expect((await pathwayRoute.PUT(get(), S({ step: "drums" }))).status).toBe(400);
    expect((await (await shareRoute.PUT(get(), S({ kind: "close_friend" }))).json()).shareSteps).toHaveLength(1);
    as(BASE);
    expect((await shareRoute.PUT(get(), S({ kind: "social" }))).status).toBe(403);
  });

  it("checkpoints are ticked by P&W; credits only follow sign-offs and can only be revoked", async () => {
    as(PW_MEMBER);
    const r = await (await checkpointRoute.PUT(req({ done: true, note: "Tuesday" }, "PUT"), S({ kind: "prayer_room_test" }))).json();
    expect(r.checkpoints.find((c: { kind: string }) => c.kind === "prayer_room_test")).toMatchObject({ note: "Tuesday", by_user: PW_MEMBER });
    expect(await why(await checkpointRoute.PUT(req({ done: true }, "PUT"), S({ kind: "credits_splits_agreed" })))).toEqual(["forbidden", "credits_follow_confirmations"]);
    as(WRITER);
    expect(await why(await checkpointRoute.PUT(req({ done: true }, "PUT"), S({ kind: "recording" })))).toEqual(["forbidden", "not_manager"]);
    agreeAll(h.db, SONG);
    as(PW_MEMBER);
    expect((await checkpointRoute.DELETE(get(), S({ kind: "credits_splits_agreed" }))).status).toBe(200);
    expect(h.db.raw("song_library_writers").filter((w) => w.song_id === SONG).every((w) => !w.confirmed_at)).toBe(true);
  });

  it("GET /helpers is HelpersPage; PUT/DELETE /helpers/:category toggles mine", async () => {
    as(SUB_ALL);
    expect((await (await helperOne.PUT(get(), p({ category: "keys" }))).json()).mySignups).toEqual(["keys"]);
    const page = await (await helpers.GET()).json();
    expect(page.mySignups).toEqual(["keys"]);
    expect(page.categoryCounts.keys).toBeGreaterThanOrEqual(1);
    expect(page.openRequests[0]).toMatchObject({ songTitle: "Harbour Lights", askedByName: "Dani Blood" });
    expect((await (await helperOne.DELETE(get(), p({ category: "keys" }))).json()).mySignups).toEqual([]);
    expect((await helperOne.PUT(get(), p({ category: "tuba" }))).status).toBe(400);
  });

  it("DELETE /subscriptions with the same body turns a subscription off", async () => {
    as(SUB_WRITER);
    await subs.POST(req({ target_type: "writer", target_user_id: WRITER }));
    expect((await (await subs.DELETE(req({ target_type: "writer", target_user_id: WRITER }, "DELETE"))).json()).deleted).toBe(1);
    expect((await (await subs.DELETE(req({ target_type: "writer", target_user_id: WRITER }, "DELETE"))).json()).deleted).toBe(0);
    expect((await (await subs.DELETE(req({ target_type: "all_uploads" }, "DELETE"))).json()).deleted).toBe(1);
    expect(h.db.raw("song_library_subscriptions").filter((x) => x.user_id === SUB_WRITER)).toHaveLength(1);
  });
});
