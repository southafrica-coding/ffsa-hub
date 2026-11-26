import { listHelpers } from "../_lib/help";

// /api/song-library/helpers. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

export async function GET() {
  return listHelpers();
}
