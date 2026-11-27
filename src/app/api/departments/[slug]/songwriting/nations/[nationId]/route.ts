import { deleteNation, getNation, patchNation } from "../../_lib/handlers";

// /api/departments/[slug]/songwriting/nations/[nationId]

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; nationId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug, nationId } = await params;
  return getNation(slug, nationId);
}

export async function PATCH(request: Request, { params }: Params) {
  const { slug, nationId } = await params;
  return patchNation(request, slug, nationId);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { slug, nationId } = await params;
  return deleteNation(slug, nationId);
}
