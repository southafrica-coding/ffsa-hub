import { deleteLeadEvent } from "../../../../_lib/handlers";

// /api/departments/[slug]/songwriting/leads/[leadId]/events/[eventId]
// Delete a logged contact: the person who logged it, or an admin (424).

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; leadId: string; eventId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { slug, leadId, eventId } = await params;
  return deleteLeadEvent(slug, leadId, eventId);
}
