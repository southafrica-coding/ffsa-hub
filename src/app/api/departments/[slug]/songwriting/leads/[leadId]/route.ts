import { deleteLead, getLead, patchLead } from "../../_lib/handlers";

// /api/departments/[slug]/songwriting/leads/[leadId]

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; leadId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug, leadId } = await params;
  return getLead(slug, leadId);
}

export async function PATCH(request: Request, { params }: Params) {
  const { slug, leadId } = await params;
  return patchLead(request, slug, leadId);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { slug, leadId } = await params;
  return deleteLead(slug, leadId);
}
