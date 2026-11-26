import { updateBlockout, deleteBlockout } from "../../_lib/handlers";

// PATCH/DELETE /api/departments/[slug]/people-manager/blockouts/[blockoutId] — change or remove one of my block-outs.

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; blockoutId: string }> }) {
  const { slug, blockoutId } = await params;
  return updateBlockout(request, slug, blockoutId);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; blockoutId: string }> }) {
  const { slug, blockoutId } = await params;
  return deleteBlockout(request, slug, blockoutId);
}
