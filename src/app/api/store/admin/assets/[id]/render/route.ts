import { startRender } from "../../_start";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/store/admin/assets/[id]/render — render again (after a failure,
// or a render that timed out). Same background job as /complete.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return startRender(id, ["uploaded", "failed", "awaiting_upload"]);
}
