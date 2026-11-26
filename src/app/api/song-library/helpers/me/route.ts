import { putMyHelperCategories } from "../../_lib/help";

// /api/song-library/helpers/me. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  return putMyHelperCategories(request);
}
