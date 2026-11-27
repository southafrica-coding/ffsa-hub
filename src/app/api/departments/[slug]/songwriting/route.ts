import { getOverview } from "./_lib/handlers";

// GET /api/departments/[slug]/songwriting — everything the Songwriting pages read (#745's SongwritingData).

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return getOverview((await params).slug);
}
