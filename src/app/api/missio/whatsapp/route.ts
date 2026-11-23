import { NextResponse } from "next/server";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { loadInbox } from "@/lib/missio/whatsapp/inbox";
import { isSendReady, MISSIO_WHATSAPP_ROLES, whatsAppError } from "@/lib/missio/whatsapp/server";

// GET /api/missio/whatsapp
//
// Missio pastors only. The inbox: every conversation on the Missio number,
// newest first. `setup` says whether sending works yet; until migration 396
// is applied the list is empty with setup "not_installed".

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_WHATSAPP_ROLES);
  if ("response" in access) return access.response;

  const inbox = await loadInbox(access.supabase, access.orgId, isSendReady());
  if ("ok" in inbox) return whatsAppError(inbox.status, inbox.code, inbox.error);
  return NextResponse.json(inbox, { headers: { "Cache-Control": "no-store" } });
}
