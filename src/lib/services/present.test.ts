import { describe, expect, it } from "vitest";
import { toHubService } from "./present";
import { SERVICE_CATALOG, seedGrants } from "./seed";

const MINISTRIES = [
  { id: "m-pw", slug: "prayer_and_worship" },
  { id: "m-ops", slug: "operations" },
  { id: "m-media", slug: "media" },
  { id: "m-hulk", slug: "hulk" },
  { id: "m-lt", slug: "leadership_team" },
];
const IDS = Object.fromEntries(MINISTRIES.map((row) => [row.slug, row.id]));

function card(key: string) {
  const row = SERVICE_CATALOG.find((item) => item.service_key === key);
  if (!row) throw new Error(`missing catalogue row ${key}`);
  return toHubService(
    row,
    seedGrants(IDS).filter((grant) => grant.service_key === key),
    MINISTRIES,
  );
}

describe("toHubService moduleId", () => {
  it("maps each catalogue key the same way, including song_library", () => {
    expect(card("prayer_room").moduleId).toBe("prayer-room");
    expect(card("brand_kit").moduleId).toBe("brand-kit");
    expect(card("song_library").moduleId).toBe("song-library");
    expect(card("song_library").href).toBe("/song-library");
  });
});
