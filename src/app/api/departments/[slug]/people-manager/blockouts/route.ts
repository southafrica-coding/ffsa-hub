import { listBlockouts, createBlockout } from "../_lib/handlers";

// GET/POST /api/departments/[slug]/people-manager/blockouts — a person's block-outs; add one of mine.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return listBlockouts(request, slug);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return createBlockout(request, slug);
}
