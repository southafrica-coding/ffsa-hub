import { NextResponse } from "next/server";
import { z } from "zod";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { loadThread } from "@/lib/missio/whatsapp/inbox";
import { MISSIO_WHATSAPP_ROLES, threadDeps, whatsAppError } from "@/lib/missio/whatsapp/server";

// GET /api/missio/whatsapp/thread?person=<org_people id>
// GET /api/missio/whatsapp/thread?thread=<thread id>
//
// Missio pastors only. One conversation: the messages, whether they've
// opted out, and when the 24-hour free-reply window closes. By person it
// also answers before anyone has written (thread: null), so the composer
// can open from the profile.

export const dynamic = "force-dynamic";

const id = z.string().uuid();

export async function GET(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_WHATSAPP_ROLES);
  if ("response" in access) return access.response;

  const params = new URL(request.url).searchParams;
  const person = params.get("person");
  const thread = params.get("thread");
  if ((person ? 1 : 0) + (thread ? 1 : 0) !== 1) return whatsAppError(400, "invalid_input", "Check the fields and try again.");
  const key = person ? { personId: person } : { threadId: thread as string };
  if (!id.safeParse(person ?? thread).success) return whatsAppError(400, "invalid_input", "Check the fields and try again.");

  const view = await loadThread(threadDeps(access), key);
  if ("ok" in view) return whatsAppError(view.status, view.code, view.error);
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
