import { decideRequest } from "../../../_lib/handlers";

// POST /api/departments/[slug]/people-manager/requests/[requestId]/decision — { decision, note? }. The first decision wins (409 leave_request_already_decided after).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; requestId: string }> }) {
  const { slug, requestId } = await params;
  return decideRequest(request, slug, requestId);
}
