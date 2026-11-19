import { NextResponse } from "next/server";
import { STEP_SPEC, bad, dbError, isUuid, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import { addLegalApplicationStep } from "@/services/legal-documents";

// POST — add a checklist step to an application.
export const POST = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad application id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const body = await readJson(request);
    if (!body || !("label" in body)) return bad("A step needs a label");

    const data = pick(body, STEP_SPEC) as { label: string; due_on?: string | null; position?: number };
    const { data: step, error } = await addLegalApplicationStep(gate.supabase, { ...data, application_id: id });
    if (error) return dbError(error);
    return NextResponse.json({ success: true, step });
  }
);
