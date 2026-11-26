import { listRequests, createRequest } from "../_lib/handlers";

// GET/POST /api/departments/[slug]/people-manager/requests — list (?scope=mine|department|pending) or ask for leave (DMs the approvers).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return listRequests(request, slug);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return createRequest(request, slug);
}
