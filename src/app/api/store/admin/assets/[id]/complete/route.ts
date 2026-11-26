import { startRender } from "../../_start";

export const runtime = "nodejs";
// The page render runs in after() inside this invocation, so this is the
// budget for rendering. Jack's 35-page, 21.9 MB draft took ~7s locally.
export const maxDuration = 300;

// POST /api/store/admin/assets/[id]/complete — step 3 of a PDF upload, once
// the browser has PUT the file straight to Storage. JSON only; no file body
// (see src/lib/store/upload.ts). Checks the stored object, then renders in
// the background and answers 202. Poll GET /api/store/admin/assets/[id].
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return startRender(id, ["awaiting_upload"]);
}
