import { NextResponse } from "next/server";
import { z } from "zod";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { isMissingRelation } from "@/lib/missio/whatsapp/store";
import { MISSIO_WHATSAPP_ROLES, whatsAppError } from "@/lib/missio/whatsapp/server";
import { markWhatsAppThreadRead } from "@/services/missio-whatsapp";

// POST /api/missio/whatsapp/thread/read  { threadId }
//
// Missio pastors only. Clears the unread count when a pastor opens a
// conversation. Through the pastor's own client: 396 grants pastors UPDATE
// on unread_count and last_read_at and nothing else.

export const dynamic = "force-dynamic";

const schema = z.object({ threadId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_WHATSAPP_ROLES);
  if ("response" in access) return access.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return whatsAppError(400, "invalid_input", "Check the fields and try again.");

  const { data, error } = await markWhatsAppThreadRead(access.supabase, access.orgId, parsed.data.threadId);
  if (error) {
    if (isMissingRelation(error)) return whatsAppError(503, "not_installed", "WhatsApp isn't switched on in the Hub yet.");
    console.error("[missio-whatsapp] mark read failed", error.code ?? "db error");
    return whatsAppError(500, "server_error", "Something went wrong.");
  }
  if (!data) return whatsAppError(404, "not_found", "Conversation not found.");
  return NextResponse.json({ ok: true });
}
