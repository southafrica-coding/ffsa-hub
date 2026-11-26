import { previewRequest } from "../_lib/handlers";

// POST /api/departments/[slug]/people-manager/preview — live weekday count, usage and who is away for the form. Writes nothing.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return previewRequest(request, slug);
}
