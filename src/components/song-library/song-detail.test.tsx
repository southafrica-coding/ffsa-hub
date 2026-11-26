import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SongDetail } from "./song-detail";
import type { SongDetail as SongDetailData, SongLibrarySong } from "./types";

const STAMP = "2026-11-26T12:00:00.000Z";

const song: SongLibrarySong = {
  id: "s-lanterns",
  title: "Lanterns in the Valley",
  created_by: "u-kiri",
  entry_point: "melody",
  pathway: "b1",
  holy_spirit_interrupt: false,
  stage: "refine",
  placement: "prayer_sets",
  music_key: null,
  bpm: null,
  lyrics_md: null,
  chart_path: null,
  current_version_id: null,
  visibility: "base",
  source_training_id: null,
  last_activity_at: STAMP,
  created_at: STAMP,
  updated_at: STAMP,
};

function detail(viewer: SongDetailData["viewer"]): SongDetailData {
  return {
    song,
    versions: [],
    pathwaySteps: [],
    events: [],
    refine: [{ song_id: song.id, q_no: 1, checked: true, note: null, by_user: "u-kiri", at: STAMP }],
    writers: [
      {
        id: "w-kiri",
        song_id: song.id,
        user_id: "u-kiri",
        display_name: "Kiri Vos",
        role: "Lead",
        is_lead: true,
        split_pct: 100,
        confirmed_at: null,
        confirmed_by: null,
        added_by: "u-kiri",
        created_at: STAMP,
        updated_at: STAMP,
        name: "Kiri Vos",
      },
    ],
    publishing: null,
    checkpoints: [],
    helpRequests: [],
    status: null,
    viewerIsWriter: viewer?.isWriter === true,
    viewerFollowsLead: false,
    viewer,
    celebrateNotes: viewer?.isWriter ? [{ song_id: song.id, prompt_no: 1, body: "Grateful.", by_user: "u-kiri", created_at: STAMP, updated_at: STAMP }] : undefined,
  };
}

function render(viewer: SongDetailData["viewer"], canManage = false) {
  return renderToStaticMarkup(
    <SongDetail scope={{ kind: "service" }} songId={song.id} canManage={canManage} ownerName="Prayer & Worship" initial={detail(viewer)} />
  );
}

describe("SongDetail refine visibility", () => {
  it("shows Refine checkboxes when viewer.canTickRefine (writers and admins)", () => {
    const html = render({ isWriter: true, canManage: false, canTickRefine: true });
    expect(html).toContain("of 10");
    expect(html).toContain('role="checkbox"');
    expect(html).toContain("Is the song cohesive");
  });

  it("hides the Refine section entirely when the viewer cannot tick it, including a manager who is not a writer", () => {
    const html = render({ isWriter: false, canManage: true, canTickRefine: false }, true);
    expect(html).not.toContain("of 10");
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain("Is the song cohesive");
    expect(html).toContain("Placement");
  });

  it("hides Refine when the song payload has no viewer", () => {
    const html = render(undefined, true);
    expect(html).not.toContain("of 10");
    expect(html).not.toContain('role="checkbox"');
  });
});

describe("SongDetail celebrate notes field", () => {
  it("keeps the song payload's celebrateNotes name (camelCase), not celebrate_notes", () => {
    const payload = detail({ isWriter: true, canManage: false, canTickRefine: true });
    expect(payload.celebrateNotes).toHaveLength(1);
    expect(payload).not.toHaveProperty("celebrate_notes");
  });
});
