import { NextResponse } from "next/server";
import { APPLICATION_SPEC, bad, dbError, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import { isApplicationOpen, todayInSA } from "@/lib/legal/status";
import { createLegalApplication, type LegalApplicationInput } from "@/services/legal-documents";

// POST — start an application (optionally for a document). The person
// starting it is responsible unless someone else is named.
export const POST = withBadField(async (request: Request) => {
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const body = await readJson(request);
  if (!body) return bad("Expected a JSON body");
  if (!("folder_id" in body) || !("title" in body)) return bad("Folder and title are required");

  const data = pick(body, APPLICATION_SPEC) as LegalApplicationInput;
  if (data.status && !isApplicationOpen(data.status) && !data.closed_on) data.closed_on = todayInSA();
  const { data: application, error } = await createLegalApplication(gate.supabase, {
    ...data,
    responsible_id: data.responsible_id ?? gate.userId,
    created_by: gate.userId,
  });
  if (error) return dbError(error);
  return NextResponse.json({ success: true, application });
});
