import { cancelRequest } from "../../../_lib/handlers";

// POST /api/departments/[slug]/people-manager/requests/[requestId]/cancel — the requester cancels.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; requestId: string }> }) {
  const { slug, requestId } = await params;
  return cancelRequest(request, slug, requestId);
}
