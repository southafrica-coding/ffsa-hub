import { NextResponse } from "next/server";
import { APPLICATION_SPEC, bad, dbError, isUuid, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import { isApplicationOpen, todayInSA } from "@/lib/legal/status";
import { updateLegalApplication, type LegalApplicationInput } from "@/services/legal-documents";

// PATCH — change fields or move it along. Closing (approved / refused /
// withdrawn) stamps today's date unless one is given; reopening clears it,
// matching CHECK legal_applications_closed in 370.
export const PATCH = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad application id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const body = await readJson(request);
    if (!body) return bad("Expected a JSON body");

    const data = pick(body, APPLICATION_SPEC) as Partial<LegalApplicationInput>;
    if (data.status) {
      if (isApplicationOpen(data.status)) data.closed_on = null;
      else if (!data.closed_on) data.closed_on = todayInSA();
    }
    if (Object.keys(data).length === 0) return bad("Nothing to change");

    const { data: application, error } = await updateLegalApplication(gate.supabase, id, data);
    if (error) return dbError(error);
    return NextResponse.json({ success: true, application });
  }
);
