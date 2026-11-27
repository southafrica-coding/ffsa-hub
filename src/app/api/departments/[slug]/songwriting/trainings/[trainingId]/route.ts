import { deleteTraining, getTraining, patchTraining } from "../../_lib/handlers";

// /api/departments/[slug]/songwriting/trainings/[trainingId]

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; trainingId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug, trainingId } = await params;
  return getTraining(slug, trainingId);
}

export async function PATCH(request: Request, { params }: Params) {
  const { slug, trainingId } = await params;
  return patchTraining(request, slug, trainingId);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { slug, trainingId } = await params;
  return deleteTraining(slug, trainingId);
}
