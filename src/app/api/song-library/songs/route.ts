import { createSong, listSongs } from "../_lib/songs";

// /api/song-library/songs. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return listSongs(request);
}

export async function POST(request: Request) {
  return createSong(request);
}
