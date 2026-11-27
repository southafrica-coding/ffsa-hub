import { createLead, listLeads } from "../_lib/handlers";

// /api/departments/[slug]/songwriting/leads
// GET filters: ?status=a,b &kind= &nation_id= &source_training_id= &contact_user_id= &owner=<id>|me|none &q= &limit=

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  return listLeads(request, (await params).slug);
}

export async function POST(request: Request, { params }: Params) {
  return createLead(request, (await params).slug);
}
