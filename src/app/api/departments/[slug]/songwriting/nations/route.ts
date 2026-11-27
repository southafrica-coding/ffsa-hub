import { createNation, listNations } from "../_lib/handlers";

// /api/departments/[slug]/songwriting/nations

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  return listNations((await params).slug);
}

export async function POST(request: Request, { params }: Params) {
  return createNation(request, (await params).slug);
}
