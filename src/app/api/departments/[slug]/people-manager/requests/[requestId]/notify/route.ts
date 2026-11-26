import { notifyRequest } from "../../../_lib/handlers";

// POST /api/departments/[slug]/people-manager/requests/[requestId]/notify — retry any Slack DM that was missed. Safe to repeat.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; requestId: string }> }) {
  const { slug, requestId } = await params;
  return notifyRequest(request, slug, requestId);
}
