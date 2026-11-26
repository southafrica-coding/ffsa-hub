import { getAway } from "../_lib/handlers";

// GET /api/departments/[slug]/people-manager/away — ?from= &to= who is away, headcount per weekday, public holidays.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return getAway(request, slug);
}
