import { getOverview } from "./_lib/handlers";

// GET /api/departments/[slug]/people-manager — me, leave types, my usage this year, who my requests go to.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return getOverview(request, slug);
}
