import { getRequest } from "../../_lib/handlers";

// GET /api/departments/[slug]/people-manager/requests/[requestId] — one request with usage and who else is away.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; requestId: string }> }) {
  const { slug, requestId } = await params;
  return getRequest(request, slug, requestId);
}
