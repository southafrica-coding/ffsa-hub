import { NextResponse } from "next/server";
import { z } from "zod";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingColumn, isMissingRelation } from "@/lib/missio/whatsapp/store";
import { MISSIO_WHATSAPP_ROLES, whatsAppError } from "@/lib/missio/whatsapp/server";
import { supabaseWhatsAppStore } from "@/lib/missio/whatsapp/supabase-store";
import type { BotModeResponse } from "@/lib/missio/whatsapp/types";
import { setWhatsAppBotMode } from "@/services/missio-whatsapp";

// POST /api/missio/whatsapp/thread/bot  { threadId, action: "take_over" | "pause" | "resume" }
//
// Missio pastors only. Who has the chat:
//   take_over  bot paused, reason "pastor" (the pastor writes next; nothing is sent)
//   pause      bot paused
//   resume     bot back on; the next message they send gets the menu
//
// The mode is written through the pastor's own client: 397 grants pastors
// UPDATE on the bot columns only, and its trigger stamps who and when. Any
// open menu step is then closed (service role, after the pastor check) so
// a resumed bot starts from the welcome rather than a stale question.
// Nothing here sends a WhatsApp message.

export const dynamic = "force-dynamic";

const schema = z.object({ threadId: z.string().uuid(), action: z.enum(["take_over", "pause", "resume"]) }).strict();

const NOT_INSTALLED = "The WhatsApp menu isn’t switched on in the Hub yet (database update 397 is waiting).";

export async function POST(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_WHATSAPP_ROLES);
  if ("response" in access) return access.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return whatsAppError(400, "invalid_input", "Check the fields and try again.");
  const { threadId, action } = parsed.data;

  const patch =
    action === "resume"
      ? { bot_mode: "on" as const, bot_handoff_reason: null }
      : { bot_mode: "paused" as const, bot_handoff_reason: action === "take_over" ? ("pastor" as const) : null };

  const { data, error } = await setWhatsAppBotMode(access.supabase, access.orgId, threadId, patch);
  if (error) {
    if (isMissingColumn(error) || isMissingRelation(error)) return whatsAppError(503, "not_installed", NOT_INSTALLED);
    console.error("[missio-whatsapp] bot mode failed", error.code ?? "db error");
    return whatsAppError(500, "server_error", "Something went wrong.");
  }
  if (!data) return whatsAppError(404, "not_found", "Conversation not found.");

  try {
    await supabaseWhatsAppStore(createAdminClient()).closeSession(threadId, action === "resume" ? "cancelled" : "paused");
  } catch {
    // The mode is what silences the bot; a session left open only means the
    // next menu step after Resume may pick up where it was.
    console.error("[missio-whatsapp] bot session close failed");
  }

  const row = data as { bot_mode: "on" | "paused"; bot_paused_at: string | null; bot_handoff_reason: "pastor" | null };
  const body: BotModeResponse = { ok: true, bot: { mode: row.bot_mode, reason: row.bot_handoff_reason, pausedAt: row.bot_paused_at } };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
