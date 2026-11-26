import { getUsage } from "../_lib/handlers";

// GET /api/departments/[slug]/people-manager/usage — ?year= &person= used and pending per type vs guideline.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return getUsage(request, slug);
}
