import { NextResponse } from "next/server";
import { z } from "zod";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { missioRateLimit } from "@/lib/missio/limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendConfig } from "@/lib/missio/whatsapp/config";
import { messageView } from "@/lib/missio/whatsapp/inbox";
import { whatsAppE164 } from "@/lib/missio/whatsapp/phone";
import { MAX_TEXT_LENGTH, MAX_VARIABLE_LENGTH } from "@/lib/missio/whatsapp/rules";
import { pauseBotAfterPastorSend, sendFromHub, SEND_MESSAGES, type SendTarget } from "@/lib/missio/whatsapp/send";
import { isMissingRelation } from "@/lib/missio/whatsapp/store";
import { supabaseWhatsAppStore } from "@/lib/missio/whatsapp/supabase-store";
import { approvedTemplates, MISSIO_WHATSAPP_ROLES, threadDeps, whatsAppError } from "@/lib/missio/whatsapp/server";
import { getWhatsAppThreadById } from "@/services/missio-whatsapp";
import type { SendResponse } from "@/lib/missio/whatsapp/types";

// POST /api/missio/whatsapp/send
//   { personId | threadId, text }                                   free reply
//   { personId | threadId, template: { name, language, values } }   approved template
//
// Missio pastors only, from the Missio number. Checked in this order, and
// nothing is written or sent until every check passes: pastor → WhatsApp
// switched on (503) → rate limit → input → the person's number → opted out
// → 24-hour window or an approved template. See lib/missio/whatsapp/send.ts.
// A reply that WhatsApp accepts pauses the menu bot on that thread (397),
// so the bot can't talk over the pastor. Resume it from the thread.

export const dynamic = "force-dynamic";

const target = { personId: z.string().uuid().optional(), threadId: z.string().uuid().optional() };

const schema = z.union([
  z.object({ ...target, text: z.string().min(1).max(MAX_TEXT_LENGTH) }).strict(),
  z
    .object({
      ...target,
      template: z
        .object({
          name: z.string().min(1).max(512),
          language: z.string().min(2).max(15),
          values: z.record(z.string().max(40), z.string().max(MAX_VARIABLE_LENGTH)).default({}),
        })
        .strict(),
    })
    .strict(),
]);

export async function POST(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_WHATSAPP_ROLES);
  if ("response" in access) return access.response;

  const config = sendConfig();
  if (!config) return whatsAppError(503, "not_configured", SEND_MESSAGES.not_configured);

  const limited = await missioRateLimit(access.user.id, "whatsapp-send");
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Boolean(parsed.data.personId) === Boolean(parsed.data.threadId)) {
    return whatsAppError(400, "invalid_input", "Check the fields and try again.");
  }
  const input = parsed.data;

  // Who it goes to: a Missio person's number, or an existing conversation.
  let to: SendTarget;
  if (input.personId) {
    const deps = threadDeps(access);
    const person = await deps.loadPerson(input.personId);
    if ("status" in person) {
      return person.status === 404
        ? whatsAppError(404, "not_found", "Person not found.")
        : whatsAppError(500, "server_error", "Something went wrong.");
    }
    const raw = await deps.readPhone(person.contactId);
    if (!raw) return whatsAppError(400, "no_phone", "There's no phone number for them in People.");
    const e164 = whatsAppE164(raw);
    if (!e164) return whatsAppError(400, "bad_phone", "Their phone number in People doesn't look like a WhatsApp number.");
    to = { e164, contactId: person.contactId };
  } else {
    const found = await getWhatsAppThreadById(access.supabase, access.orgId, input.threadId as string);
    if (found.error) {
      if (isMissingRelation(found.error)) return whatsAppError(503, "not_installed", SEND_MESSAGES.not_installed);
      return whatsAppError(500, "server_error", "Something went wrong.");
    }
    const thread = found.data as { phone_e164: string; contact_id: string | null } | null;
    if (!thread) return whatsAppError(404, "not_found", "Conversation not found.");
    to = { e164: thread.phone_e164, contactId: thread.contact_id };
  }

  const store = supabaseWhatsAppStore(createAdminClient());
  const result = await sendFromHub(
    {
      store,
      config,
      loadTemplates: () => approvedTemplates(config),
    },
    {
      orgId: access.orgId,
      userId: access.user.id,
      target: to,
      content: "text" in input ? { kind: "text", text: input.text } : { kind: "template", ...input.template },
    }
  );
  if (!result.ok) return whatsAppError(result.status, result.code, result.error);

  const body: SendResponse = { message: messageView(result.message), threadId: result.threadId };
  if (result.message.status !== "failed") await pauseBotAfterPastorSend(store, result.threadId, access.user.id);
  if (result.message.status === "failed") {
    // Kept in the thread so the pastor sees what didn't go, and why.
    return NextResponse.json({ ...body, error: `WhatsApp didn't take it: ${body.message.error ?? "unknown error"}`, code: "send_failed" }, { status: 502 });
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
