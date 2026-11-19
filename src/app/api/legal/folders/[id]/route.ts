import { NextResponse } from "next/server";
import { FOLDER_SPEC, bad, dbError, isUuid, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import { updateLegalFolder } from "@/services/legal-documents";

// PATCH — rename, describe, or archive ({ archived: true / false }).
export const PATCH = withBadField(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isUuid(id)) return bad("Bad folder id");
    const gate = await legalGate();
    if (gate.error) return gate.error;
    const body = await readJson(request);
    if (!body) return bad("Expected a JSON body");

    const data: Record<string, unknown> = pick(body, FOLDER_SPEC);
    if ("archived" in body) data.archived_at = body.archived ? new Date().toISOString() : null;
    if (Object.keys(data).length === 0) return bad("Nothing to change");

    const { data: folder, error } = await updateLegalFolder(gate.supabase, id, data);
    if (error) return dbError(error);
    return NextResponse.json({ success: true, folder });
  }
);
