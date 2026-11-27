import { describe, expect, it } from "vitest";
import { isChartPathFor, isVersionPathFor, parseSongPatch } from "./validate";

const SONG = "00000000-0000-4000-8000-00000000d001";
const OTHER = "00000000-0000-4000-8000-00000000d002";
const U = "11111111-2222-4333-8444-555555555555";

describe("chart_path (PATCH /songs/:id)", () => {
  it("accepts only a chart the API handed out, in this song's own prefix", () => {
    expect(isChartPathFor(SONG, `${SONG}/chart-${U}.pdf`)).toBe(true);
    expect(parseSongPatch({ chart_path: `${SONG}/chart-${U}.png` }, SONG)).toEqual({ ok: true, value: { chart_path: `${SONG}/chart-${U}.png` } });
    expect(parseSongPatch({ chart_path: null }, SONG)).toEqual({ ok: true, value: { chart_path: null } });
  });

  it("refuses another song's prefix, a leading slash, '..', nested folders, audio paths and junk", () => {
    for (const path of [
      `${OTHER}/chart-${U}.pdf`,
      `/${SONG}/chart-${U}.pdf`,
      `${SONG}/chart-../../${OTHER}/chart-${U}.pdf`,
      `${SONG}/chart-${U}/../x.pdf`,
      `${SONG}/charts/chart-${U}.pdf`,
      `${SONG}/chart-anything.pdf`,
      `${SONG}/v-${U}.mp3`,
      `song-library/${SONG}/chart-${U}.pdf`,
      `${SONG}/chart-${U}.pdf\n`,
      42,
    ]) {
      expect(isChartPathFor(SONG, path)).toBe(false);
      expect(parseSongPatch({ chart_path: path }, SONG).ok).toBe(false);
    }
  });

  it("chart and audio paths do not stand in for each other", () => {
    expect(isVersionPathFor(SONG, `${SONG}/chart-${U}.pdf`)).toBe(false);
    expect(isVersionPathFor(SONG, `${SONG}/v-${U}.mp3`)).toBe(true);
  });
});
