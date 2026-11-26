import { describe, expect, it } from "vitest";
import {
  allowedStages,
  canConfirmWriter,
  canDeleteSong,
  canEditPublishing,
  canEditSong,
  canMoveStage,
  canReadCelebrate,
  canSetPlacement,
  canWithdrawConfirmation,
  type SongLibraryViewer,
} from "./access";
import { SONG_STAGES } from "./types";
import { checkSplits, parseSplits, splitHundredths } from "./validate";

const viewer = (over: Partial<SongLibraryViewer> = {}): SongLibraryViewer => ({ userId: "me", isAdmin: false, canManage: false, ...over });
const writer = { isWriter: true, isLeadWriter: false };
const lead = { isWriter: true, isLeadWriter: true };
const nobody = { isWriter: false, isLeadWriter: false };
const manager = viewer({ canManage: true });
const admin = viewer({ isAdmin: true });

describe("stage moves", () => {
  it("lets a writer move through the early stages, skipping ahead or back", () => {
    expect(canMoveStage(viewer(), writer, "idea_entry", "refine")).toBe(true);
    expect(canMoveStage(viewer(), writer, "writing", "written_needs_demo")).toBe(true);
    expect(canMoveStage(viewer(), writer, "refine", "writing")).toBe(true);
  });
  it("never lets a writer into or out of demo_ready, share or celebrate", () => {
    expect(canMoveStage(viewer(), writer, "written_needs_demo", "demo_ready")).toBe(false);
    expect(canMoveStage(viewer(), writer, "idea_entry", "celebrate")).toBe(false);
    expect(canMoveStage(viewer(), writer, "share", "writing")).toBe(false);
    expect(canMoveStage(viewer(), writer, "demo_ready", "share")).toBe(false);
  });
  it("refuses a non-writer who is not a manager", () => {
    expect(canMoveStage(viewer(), nobody, "idea_entry", "writing")).toBe(false);
  });
  it("lets any manager or admin make any move", () => {
    for (const v of [manager, admin]) {
      expect(canMoveStage(v, nobody, "idea_entry", "celebrate")).toBe(true);
      expect(canMoveStage(v, nobody, "share", "writing")).toBe(true);
    }
  });
  it("lists the moves each caller may make", () => {
    expect(allowedStages(viewer(), writer, "writing", SONG_STAGES)).toEqual(["idea_entry", "set_down", "refine", "written_needs_demo"]);
    expect(allowedStages(viewer(), writer, "demo_ready", SONG_STAGES)).toEqual([]);
    expect(allowedStages(manager, nobody, "writing", SONG_STAGES)).toHaveLength(7);
  });
});

describe("placement, edits, delete, publishing, celebrate", () => {
  it("placement is for managers only", () => {
    expect(canSetPlacement(viewer())).toBe(false);
    expect(canSetPlacement(manager)).toBe(true);
    expect(canSetPlacement(admin)).toBe(true);
  });
  it("song edits are the writers', delete the lead writer's", () => {
    expect(canEditSong(viewer(), writer)).toBe(true);
    expect(canEditSong(manager, nobody)).toBe(false);
    expect(canDeleteSong(viewer(), writer)).toBe(false);
    expect(canDeleteSong(viewer(), lead)).toBe(true);
    expect(canDeleteSong(admin, nobody)).toBe(true);
  });
  it("publishing is for writers, managers and admins (as 419)", () => {
    expect(canEditPublishing(viewer(), writer)).toBe(true);
    expect(canEditPublishing(manager, nobody)).toBe(true);
    expect(canEditPublishing(admin, nobody)).toBe(true);
    expect(canEditPublishing(viewer(), nobody)).toBe(false);
  });
  it("celebrate notes are read by writers and managers only", () => {
    expect(canReadCelebrate(viewer(), writer)).toBe(true);
    expect(canReadCelebrate(manager, nobody)).toBe(true);
    expect(canReadCelebrate(viewer(), nobody)).toBe(false);
  });
});

describe("sign-off", () => {
  it("a writer signs off only their own row; managers sign for writers with no account", () => {
    expect(canConfirmWriter(viewer(), { user_id: "me" })).toBe(true);
    expect(canConfirmWriter(viewer(), { user_id: "other" })).toBe(false);
    expect(canConfirmWriter(manager, { user_id: "other" })).toBe(false);
    expect(canConfirmWriter(viewer(), { user_id: null })).toBe(false);
    expect(canConfirmWriter(manager, { user_id: null })).toBe(true);
  });
  it("once agreed, only a manager can withdraw (revoke)", () => {
    expect(canWithdrawConfirmation(viewer(), { user_id: "me" }, false)).toBe(true);
    expect(canWithdrawConfirmation(viewer(), { user_id: "me" }, true)).toBe(false);
    expect(canWithdrawConfirmation(manager, { user_id: "me" }, true)).toBe(true);
  });
});

describe("splits validation", () => {
  const ids = ["a", "b", "c"].map((x) => `00000000-0000-4000-8000-00000000000${x}`);
  it("accepts two decimals and refuses more", () => {
    expect(splitHundredths(33.33)).toBe(3333);
    expect(splitHundredths(33.333)).toBeNull();
    expect(splitHundredths(-1)).toBeNull();
    expect(splitHundredths(100.01)).toBeNull();
  });
  it("needs every writer to have a split and the total to be exactly 100", () => {
    expect(checkSplits([])).toMatchObject({ ok: false, reason: "no_writers" });
    expect(checkSplits([{ id: "a", split_pct: 50 }, { id: "b", split_pct: null }])).toMatchObject({ ok: false, reason: "missing_split", missing: ["b"] });
    expect(checkSplits([{ id: "a", split_pct: 50 }, { id: "b", split_pct: 45 }])).toMatchObject({ ok: false, reason: "not_100", totalPct: 95 });
    expect(checkSplits([{ id: "a", split_pct: 33.33 }, { id: "b", split_pct: 33.33 }, { id: "c", split_pct: 33.34 }])).toEqual({ ok: true, totalPct: 100 });
    expect(checkSplits([{ id: "a", split_pct: "60.00" }, { id: "b", split_pct: "40" }])).toEqual({ ok: true, totalPct: 100 });
  });
  it("parses a bulk split: writers only, each once, all of them, total 100", () => {
    const s = (pairs: [number, number][]) => ({ splits: pairs.map(([i, p]) => ({ writer_id: ids[i], split_pct: p })) });
    expect(parseSplits(s([[0, 50], [1, 40], [2, 10]]), ids).ok).toBe(true);
    expect(parseSplits(s([[0, 50], [1, 40], [2, 5]]), ids)).toMatchObject({ ok: false, error: expect.stringContaining("95") });
    expect(parseSplits(s([[0, 60], [1, 40]]), ids)).toMatchObject({ ok: false, error: expect.stringContaining("every writer") });
    expect(parseSplits(s([[0, 50], [0, 50]]), ids.slice(0, 1))).toMatchObject({ ok: false });
    expect(parseSplits({ splits: [{ writer_id: "00000000-0000-4000-8000-0000000000ff", split_pct: 100 }] }, ids)).toMatchObject({ ok: false, error: expect.stringContaining("writers") });
    expect(parseSplits(s([[0, 33.333], [1, 33.333], [2, 33.334]]), ids)).toMatchObject({ ok: false });
  });
});
