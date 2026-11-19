import { NextResponse } from "next/server";
import { FOLDER_SPEC, bad, dbError, legalGate, pick, readJson, withBadField } from "@/lib/legal/api";
import { createLegalFolder, type LegalFolderKind } from "@/services/legal-documents";

// POST — a new folder. RLS: whole-module editors only.
export const POST = withBadField(async (request: Request) => {
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const body = await readJson(request);
  if (!body) return bad("Expected a JSON body");
  if (!("name" in body) || !("kind" in body)) return bad("Name and kind are required");

  const data = pick(body, FOLDER_SPEC) as { name: string; kind: LegalFolderKind; description?: string | null };
  const { data: folder, error } = await createLegalFolder(gate.supabase, { ...data, created_by: gate.userId });
  if (error) return dbError(error);
  return NextResponse.json({ success: true, folder });
});
