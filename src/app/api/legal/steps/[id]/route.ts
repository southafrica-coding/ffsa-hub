import { NextResponse } from "next/server";
import { STEP_SPEC, bad, dbError, isUuid, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import {
  deleteLegalApplicationStep,
  setLegalApplicationStepDone,
  updateLegalApplicationStep,
} from "@/services/legal-documents";

// PATCH — tick a step ({ done: true / false }) or change its text.
export const PATCH = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad step id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const body = await readJson(request);
    if (!body) return bad("Expected a JSON body");

    const data = pick(body, STEP_SPEC);
    if (!("done" in body) && Object.keys(data).length === 0) return bad("Nothing to change");

    const { data: step, error } =
      "done" in body
        ? await setLegalApplicationStepDone(gate.supabase, id, body.done ? gate.userId : null)
        : await updateLegalApplicationStep(gate.supabase, id, data);
    if (error) return dbError(error);
    return NextResponse.json({ success: true, step });
  }
);

// DELETE — remove a step.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad step id");
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const { data, error } = await deleteLegalApplicationStep(gate.supabase, id);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
