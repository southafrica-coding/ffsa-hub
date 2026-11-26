import { describe, expect, it, vi } from "vitest";
import { buildUploadDm, canSendSongLibraryDm, notificationClaims, runSongUploadDms, type SongDmDeps } from "./song-library-notify";
import { COWRITER, SONG, SUB_ALL, SUB_NOSLACK, SUB_WRITER, V1, WRITER, makeSongWorld } from "@/lib/song-library/testing/world";

vi.mock("@/lib/slack/client", () => ({ openConversation: vi.fn(), postMessage: vi.fn() })); // never real Slack
vi.mock("@/lib/slack/bots", () => ({ isBotConfigured: () => true }));

const LIVE = { VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://hub.test" } as unknown as NodeJS.ProcessEnv;
const V2 = "00000000-0000-4000-8000-00000000f002";

function deps(send?: SongDmDeps["sendSlackDm"]) {
  return {
    sendSlackDm: vi.fn<SongDmDeps["sendSlackDm"]>(send ?? (async () => ({ ok: true, ts: "1700000000.0001" }))),
    slackReady: () => true,
    now: () => new Date("2026-11-26T19:00:00Z"),
    log: vi.fn<(m: string) => void>(),
  };
}

function withSecondVersion() {
  const db = makeSongWorld();
  db.raw("song_library_versions").push({ id: V2, song_id: SONG, n: 2, label: "full demo <final>", storage_path: `${SONG}/v-00000000-0000-4000-8000-000000000002.wav`, duration_s: 201, is_demo: true, uploaded_by: COWRITER });
  db.raw("song_library_stage_events").push({ id: "ev-v2", song_id: SONG, kind: "version", payload: { version_id: V2, n: 2 }, by_user: COWRITER, at: "2026-11-26T18:00:00.000Z" });
  return db;
}

const to = (d: ReturnType<typeof deps>) => d.sendSlackDm.mock.calls.map((c) => c[0]).sort();

describe("new song DMs", () => {
  it("DMs each subscriber once, skips the uploader, and skips and logs someone without Slack", async () => {
    const db = makeSongWorld();
    const d = deps();
    const run = await runSongUploadDms(db.client(), V1, { deps: d, env: LIVE });
    expect(run.kind).toBe("new_upload");
    expect(Object.fromEntries(run.results.map((r) => [r.user_id, [r.outcome, r.reason]]))).toEqual({
      [SUB_ALL]: ["sent", "all_uploads"],
      [SUB_WRITER]: ["sent", "writer"],
      [SUB_NOSLACK]: ["no-slack", "all_uploads"],
    });
    expect(run.results.find((r) => r.user_id === WRITER)).toBeUndefined();
    expect(to(d)).toEqual(["U_SUB_ALL", "U_SUB_WRITER"]);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining(`user ${SUB_NOSLACK} has no Slack id`));
    const rows = db.raw("song_library_notifications");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "new_upload" && r.sent_at && r.slack_ts === "1700000000.0001")).toBe(true);
  });

  it("sends nothing on a second run", async () => {
    const db = makeSongWorld();
    const d = deps();
    await runSongUploadDms(db.client(), V1, { deps: d, env: LIVE });
    const again = await runSongUploadDms(db.client(), V1, { deps: d, env: LIVE });
    expect(again.results.filter((r) => r.outcome === "sent")).toHaveLength(0);
    expect(again.results.filter((r) => r.outcome === "already-sent")).toHaveLength(2);
    expect(d.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("sends exactly one DM per subscriber when runs race", async () => {
    const db = makeSongWorld();
    const d = deps();
    await Promise.all([1, 2, 3, 4, 5].map(() => runSongUploadDms(db.client(), V1, { deps: d, env: LIVE })));
    expect(to(d)).toEqual(["U_SUB_ALL", "U_SUB_WRITER"]);
    expect(db.raw("song_library_notifications")).toHaveLength(2);
  });

  it("gives the claim back when Slack refuses, so a retry sends", async () => {
    const db = makeSongWorld();
    const failing = deps(async () => ({ ok: false, error: "channel_not_found" }));
    const r = await runSongUploadDms(db.client(), V1, { deps: failing, env: LIVE });
    expect(r.results.filter((x) => x.outcome === "error")).toHaveLength(2);
    expect(db.raw("song_library_notifications")).toHaveLength(0);
    const ok = deps();
    await runSongUploadDms(db.client(), V1, { deps: ok, env: LIVE });
    expect(ok.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("says why, links back to the song and escapes names", async () => {
    const db = makeSongWorld();
    db.raw("song_library_songs").find((s) => s.id === SONG)!.title = "Harbour <Lights> & co";
    const d = deps();
    await runSongUploadDms(db.client(), V1, { deps: d, env: LIVE });
    const byWho = Object.fromEntries(d.sendSlackDm.mock.calls.map((c) => [c[0], JSON.stringify(c[1].blocks)]));
    expect(byWho.U_SUB_WRITER).toContain("You get this because you subscribe to Noah Lind.");
    expect(byWho.U_SUB_ALL).toContain("You get this because you follow all uploads.");
    expect(byWho.U_SUB_ALL).toContain("Dani Blood");
    expect(byWho.U_SUB_ALL).toContain("uploaded a new song “Harbour &lt;Lights&gt; &amp; co”");
    expect(byWho.U_SUB_ALL).toContain("started with Melody · Writing");
    expect(byWho.U_SUB_ALL).toContain(`https://hub.test/song-library/songs/${SONG}`);
    // Unsubscribe goes where Hub UI's toggle lives: the home switch, or the writer's page.
    expect(byWho.U_SUB_ALL).toContain('"url":"https://hub.test/song-library"');
    expect(byWho.U_SUB_WRITER).toContain(`https://hub.test/song-library/writers/${COWRITER}`);
  });
});

describe("new version DMs", () => {
  it("sends nothing and claims nothing while 419 has no version claim", async () => {
    const db = withSecondVersion();
    const d = deps();
    const r = await runSongUploadDms(db.client(), V2, { deps: d, env: LIVE });
    expect(r.kind).toBe("new_version");
    expect(r.results.every((x) => x.outcome === "unsupported" || x.outcome === "no-slack")).toBe(true);
    expect(d.sendSlackDm).not.toHaveBeenCalled();
    expect(db.raw("song_library_notifications")).toHaveLength(0);
  });

  it("with a version claim: one DM per subscriber per version, the uploader skipped, races safe", async () => {
    const db = withSecondVersion();
    const d = deps();
    const claims = notificationClaims(db.client(), { versionClaims: true });
    await Promise.all([1, 2, 3].map(() => runSongUploadDms(db.client(), V2, { deps: d, env: LIVE, claims })));
    // COWRITER uploaded v2; WRITER follows all uploads, so now gets it.
    expect(to(d)).toEqual(["U_SUB_ALL", "U_SUB_WRITER", "U_WRITER"]);
    expect(db.raw("song_library_notifications").every((n) => n.kind === "new_version" && n.stage_event_id === "ev-v2")).toBe(true);
    const body = JSON.stringify(d.sendSlackDm.mock.calls[0][1].blocks);
    expect(body).toContain("uploaded version 2 of");
    expect(body).toContain("full demo &lt;final&gt; 3:21");
  });
});

describe("production only", () => {
  it("is off on previews and when preview writes are disabled, and claims nothing", async () => {
    expect(canSendSongLibraryDm({ VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(canSendSongLibraryDm({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(canSendSongLibraryDm({ VERCEL_ENV: "production", PREVIEW_WRITES_DISABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(canSendSongLibraryDm(LIVE)).toBe(true);
    const db = makeSongWorld();
    const d = deps();
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: "production", PREVIEW_WRITES_DISABLED: "1" }]) {
      const r = await runSongUploadDms(db.client(), V1, { deps: d, env: env as unknown as NodeJS.ProcessEnv });
      expect(r.outcome).toBe("off");
    }
    expect(d.sendSlackDm).not.toHaveBeenCalled();
    expect(db.raw("song_library_notifications")).toHaveLength(0);
  });

  it("is off when the Slack bot is not configured", async () => {
    const db = makeSongWorld();
    const d = { ...deps(), slackReady: () => false };
    expect((await runSongUploadDms(db.client(), V1, { deps: d, env: LIVE })).outcome).toBe("off");
  });
});

describe("message", () => {
  it("has the listen and unsubscribe links and a plain-text fallback", () => {
    const m = buildUploadDm({ kind: "new_upload", title: "T", uploader: "U", entryPoint: "lyric", stage: "idea_entry", versionN: 1, label: null, durationS: 62, why: "w", url: "https://x/s", unsubscribeUrl: "https://x/u" });
    expect(m.text).toBe("U uploaded a new song “T”. https://x/s");
    expect(JSON.stringify(m.blocks)).toContain("Version 1 1:02");
    expect(JSON.stringify(m.blocks)).toContain('"url":"https://x/u"');
  });
});
