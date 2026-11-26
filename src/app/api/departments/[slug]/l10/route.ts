import { listTeams } from "./_lib/handlers";

// GET /api/departments/[slug]/l10 — the department's L10 teams and my role on each.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return listTeams((await params).slug);
}
