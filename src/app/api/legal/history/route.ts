import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bad, dbError, isUuid, legalGate } from "@/lib/legal/api";
import { getLegalEvents } from "@/services/legal-documents";

const TABLES = ["legal_documents", "legal_files", "legal_applications", "legal_folders", "legal_drafts"];

// GET ?table=legal_documents&id=<uuid> — who changed what on one row.
// Events are read as the user (RLS: whole-module members). Only the names
// of the people in those events are looked up with the service role.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const table = url.searchParams.get("table") ?? "";
  const id = url.searchParams.get("id");
  if (!TABLES.includes(table) || !isUuid(id)) return bad("Bad table or id");
  const gate = await legalGate();
  if (gate.error) return gate.error;

  const { data: events, error } = await getLegalEvents(gate.supabase, { tableName: table, rowId: id });
  if (error) return dbError(error);

  const actorIds = Array.from(new Set((events ?? []).map((e: { actor_id: string | null }) => e.actor_id).filter(Boolean)));
  const names = new Map<string, string>();
  if (actorIds.length) {
    const admin = createAdminClient();
    const { data: users } = await admin.from("users").select("id, first_name, last_name").in("id", actorIds);
    for (const u of users ?? []) {
      names.set(u.id, [u.first_name, u.last_name].filter(Boolean).join(" ") || "Someone");
    }
  }

  return NextResponse.json({
    events: (events ?? []).map((e: { id: number; action: string; changed: string[]; actor_id: string | null; at: string }) => ({
      id: e.id,
      action: e.action,
      changed: e.changed,
      at: e.at,
      who: e.actor_id ? names.get(e.actor_id) ?? "Someone" : "The Hub",
    })),
  });
}
