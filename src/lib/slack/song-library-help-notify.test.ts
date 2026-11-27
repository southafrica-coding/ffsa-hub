import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHelpAskedDm, helpAskedClaims, HELP_DM_REPEAT_WINDOW_MS, runHelpAskedDms } from "./song-library-help-notify";
import type { SongDmDeps } from "./song-library-notify";
import { BASE, COWRITER, DEMO_SONG, HELP, SONG, SUB_ALL, SUB_NOSLACK, WRITER, makeSongWorld } from "@/lib/song-library/testing/world";

vi.mock("@/lib/slack/client", () => ({ openConversation: vi.fn(), postMessage: vi.fn() })); // never real Slack
vi.mock("@/lib/slack/bots", () => ({ isBotConfigured: () => true }));

const LIVE = { VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://hub.test" } as unknown as NodeJS.ProcessEnv;

// Hermetic: whatever the shell running the tests has set, the process env
// these DMs can fall back to starts with no deployment and no preview flag.
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("PREVIEW_WRITES_DISABLED", undefined);
});
afterEach(() => vi.unstubAllEnvs());

function deps(send?: SongDmDeps["sendSlackDm"]) {
  return {
    sendSlackDm: vi.fn<SongDmDeps["sendSlackDm"]>(send ?? (async () => ({ ok: true, ts: "1700000000.0002" }))),
    slackReady: () => true,
    now: () => new Date("2026-11-26T22:00:00Z"),
    log: vi.fn<(m: string) => void>(),
  };
}

/** HELP (asked by WRITER, bass + drums). Helpers: BASE bass (seed), SUB_ALL drums, SUB_NOSLACK bass, WRITER bass (the asker), COWRITER keys (no match). */
function world() {
  const db = makeSongWorld();
  const h = db.raw("song_library_helpers");
  h.push({ user_id: SUB_ALL, category: "drums", note: null, created_at: "2026-11-02T10:00:00.000Z" });
  h.push({ user_id: SUB_ALL, category: "bass", note: null, created_at: "2026-11-02T10:00:00.000Z" });
  h.push({ user_id: SUB_NOSLACK, category: "bass", note: null, created_at: "2026-11-02T10:00:00.000Z" });
  h.push({ user_id: WRITER, category: "bass", note: null, created_at: "2026-11-02T10:00:00.000Z" });
  h.push({ user_id: COWRITER, category: "keys", note: null, created_at: "2026-11-02T10:00:00.000Z" });
  return db;
}
const to = (d: ReturnType<typeof deps>) => d.sendSlackDm.mock.calls.map((c) => c[0]).sort();

describe("help-asked DMs", () => {
  it("DMs each matching helper once, skips the asker, and skips and logs someone without Slack", async () => {
    const db = world();
    const d = deps();
    const run = await runHelpAskedDms(db.client(), HELP, { deps: d, env: LIVE });
    expect(Object.fromEntries(run.results.map((r) => [r.user_id, [r.outcome, r.categories]]))).toEqual({
      [BASE]: ["sent", ["bass"]],
      [SUB_ALL]: ["sent", ["bass", "drums"]],
      [SUB_NOSLACK]: ["no-slack", ["bass"]],
    });
    expect(to(d)).toEqual(["U_BASE", "U_SUB_ALL"]);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining(`user ${SUB_NOSLACK} has no Slack id`));
    const rows = db.raw("song_library_notifications");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "help_asked" && r.help_request_id === HELP && r.reason === "helper_category" && r.song_id === SONG && r.sent_at)).toBe(true);
  });

  it("sends nothing on a second run", async () => {
    const db = world();
    const d = deps();
    await runHelpAskedDms(db.client(), HELP, { deps: d, env: LIVE });
    const again = await runHelpAskedDms(db.client(), HELP, { deps: d, env: LIVE });
    expect(again.results.filter((r) => r.outcome === "already-sent")).toHaveLength(2);
    expect(d.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("sends exactly one DM per helper when runs race", async () => {
    const db = world();
    const d = deps(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, ts: "1.0" };
    });
    await Promise.all([1, 2, 3].map(() => runHelpAskedDms(db.client(), HELP, { deps: d, env: LIVE })));
    expect(to(d)).toEqual(["U_BASE", "U_SUB_ALL"]);
    expect(db.raw("song_library_notifications")).toHaveLength(2);
  });

  it("releases the claim when Slack fails, so a retry sends it", async () => {
    const db = world();
    const failing = deps(async () => ({ ok: false, error: "channel_not_found" }));
    const r = await runHelpAskedDms(db.client(), HELP, { deps: failing, env: LIVE });
    expect(r.results.filter((x) => x.outcome === "error")).toHaveLength(2);
    expect(db.raw("song_library_notifications")).toHaveLength(0);
    const ok = deps();
    await runHelpAskedDms(db.client(), HELP, { deps: ok, env: LIVE });
    expect(ok.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("is off outside production (and when preview writes are off), and claims nothing", async () => {
    for (const env of [{ VERCEL_ENV: "preview" }, {}, { VERCEL_ENV: "development" }] as unknown as NodeJS.ProcessEnv[]) {
      const db = world();
      const d = deps();
      expect((await runHelpAskedDms(db.client(), HELP, { deps: d, env })).outcome).toBe("off");
      expect(d.sendSlackDm).not.toHaveBeenCalled();
      expect(db.raw("song_library_notifications")).toHaveLength(0);
    }
  });

  it("is off on production when PREVIEW_WRITES_DISABLED is set", async () => {
    for (const flag of ["1", "true"]) {
      const db = world();
      const d = deps();
      const env = { ...LIVE, PREVIEW_WRITES_DISABLED: flag } as unknown as NodeJS.ProcessEnv;
      expect((await runHelpAskedDms(db.client(), HELP, { deps: d, env })).outcome).toBe("off");
      expect(d.sendSlackDm).not.toHaveBeenCalled();
      expect(db.raw("song_library_notifications")).toHaveLength(0);
    }
  });

  it("reads the process env when none is passed: off by default, on for a stubbed production", async () => {
    const db = world();
    const d = deps();
    expect((await runHelpAskedDms(db.client(), HELP, { deps: d })).outcome).toBe("off");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PREVIEW_WRITES_DISABLED", "1");
    expect((await runHelpAskedDms(db.client(), HELP, { deps: d })).outcome).toBe("off");
    vi.stubEnv("PREVIEW_WRITES_DISABLED", undefined);
    expect((await runHelpAskedDms(db.client(), HELP, { deps: d })).outcome).toBe("done");
    expect(d.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("sends nothing for a closed request", async () => {
    const db = world();
    db.raw("song_library_help_requests").find((x) => x.id === HELP)!.status = "filled";
    const d = deps();
    expect((await runHelpAskedDms(db.client(), HELP, { deps: d, env: LIVE })).outcome).toBe("closed");
    expect(d.sendSlackDm).not.toHaveBeenCalled();
  });

  it("links to the song page and the helpers page, and escapes text", () => {
    const m = buildHelpAskedDm({ asker: "Dani <B>", title: "A & B", categories: ["bass", "drums"], matched: ["bass"], body: "Need <groove>", url: `https://hub.test/song-library/songs/${SONG}`, helpersUrl: "https://hub.test/song-library/helpers" });
    const blocks = JSON.stringify(m.blocks);
    expect(blocks).toContain(`https://hub.test/song-library/songs/${SONG}`);
    expect(blocks).toContain("https://hub.test/song-library/helpers");
    expect(blocks).toContain("Dani &lt;B&gt;");
    expect(blocks).toContain("“A &amp; B” · Bass, Drums");
    expect(blocks).toContain("\\n>Need &lt;groove&gt;");
    expect(blocks).toContain("signed up to help with Bass.");
  });

  it("the claim store treats a duplicate as already claimed", async () => {
    const db = world();
    const claims = helpAskedClaims(db.client());
    const key = { userId: BASE, songId: SONG, helpRequestId: HELP };
    expect((await claims.claim(key)).outcome).toBe("claimed");
    expect((await claims.claim(key)).outcome).toBe("taken");
  });
});

describe("help-asked DMs: repeat limit (no re-DM for the same song and category)", () => {
  const HELP2 = "00000000-0000-4000-8000-00000000f102";
  const HELP3 = "00000000-0000-4000-8000-00000000f103";
  const HELP_DEMO = "00000000-0000-4000-8000-00000000f104";
  const ask = (db: ReturnType<typeof world>, id: string, categories: string[], songId = SONG) =>
    db.raw("song_library_help_requests").push({ id, song_id: songId, asked_by: WRITER, categories, body: "Again", status: "open", helper_user_id: null, closed_at: null, created_at: "2026-11-26T21:00:00.000Z", updated_at: "2026-11-26T21:00:00.000Z" });

  it("skips helpers already DMed for this song and these categories by another request in the window", async () => {
    const db = world();
    const d = deps();
    await runHelpAskedDms(db.client(), HELP, { deps: d, env: LIVE });
    expect(to(d)).toEqual(["U_BASE", "U_SUB_ALL"]);
    ask(db, HELP2, ["bass"]);
    const again = await runHelpAskedDms(db.client(), HELP2, { deps: d, env: LIVE });
    expect(Object.fromEntries(again.results.map((r) => [r.user_id, r.outcome]))).toEqual({ [BASE]: "recently-sent", [SUB_ALL]: "recently-sent", [SUB_NOSLACK]: "no-slack" });
    expect(d.sendSlackDm).toHaveBeenCalledTimes(2);
    expect(db.raw("song_library_notifications").filter((n) => n.help_request_id === HELP2)).toHaveLength(0);
  });

  it("still DMs someone for a category they were not DMed about", async () => {
    const db = world();
    const d = deps();
    await runHelpAskedDms(db.client(), HELP, { deps: d, env: LIVE });
    ask(db, HELP3, ["bass", "keys"]);
    const run = await runHelpAskedDms(db.client(), HELP3, { deps: d, env: LIVE });
    expect(Object.fromEntries(run.results.map((r) => [r.user_id, r.outcome]))).toMatchObject({ [BASE]: "recently-sent", [SUB_ALL]: "recently-sent", [COWRITER]: "sent" });
  });

  it("DMs again once the window has passed, and for another song", async () => {
    const db = world();
    await runHelpAskedDms(db.client(), HELP, { deps: deps(), env: LIVE });
    ask(db, HELP2, ["bass"]);
    const later = { ...deps(), now: () => new Date(Date.parse("2026-11-26T18:00:00Z") + HELP_DM_REPEAT_WINDOW_MS + 60_000) };
    await runHelpAskedDms(db.client(), HELP2, { deps: later, env: LIVE });
    expect(to(later)).toEqual(["U_BASE", "U_SUB_ALL"]);
    ask(db, HELP_DEMO, ["bass"], DEMO_SONG);
    const other = deps();
    await runHelpAskedDms(db.client(), HELP_DEMO, { deps: other, env: LIVE });
    expect(to(other)).toEqual(["U_BASE", "U_SUB_ALL"]);
  });
});
