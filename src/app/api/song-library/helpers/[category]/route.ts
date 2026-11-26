import { deleteHelperCategory, putHelperCategory } from "../../_lib/help";

// /api/song-library/helpers/[category]. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ category: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { category } = await params;
  return putHelperCategory(request, category);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { category } = await params;
  return deleteHelperCategory(category);
}
