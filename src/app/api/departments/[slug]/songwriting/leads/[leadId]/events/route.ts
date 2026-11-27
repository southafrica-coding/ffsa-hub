import { addLeadEvent, listLeadEvents } from "../../../_lib/handlers";

// /api/departments/[slug]/songwriting/leads/[leadId]/events — "Log contact".

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; leadId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug, leadId } = await params;
  return listLeadEvents(slug, leadId);
}

export async function POST(request: Request, { params }: Params) {
  const { slug, leadId } = await params;
  return addLeadEvent(request, slug, leadId);
}
