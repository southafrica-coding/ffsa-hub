import { createTraining, listTrainings } from "../_lib/handlers";

// /api/departments/[slug]/songwriting/trainings

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  return listTrainings((await params).slug);
}

export async function POST(request: Request, { params }: Params) {
  return createTraining(request, (await params).slug);
}
