import { board } from "../_lib/songs";

// /api/song-library/board. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";

export async function GET() {
  return board();
}
