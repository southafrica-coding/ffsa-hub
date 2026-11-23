import { NextResponse } from "next/server";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { sendConfig } from "@/lib/missio/whatsapp/config";
import { approvedTemplates, MISSIO_WHATSAPP_ROLES } from "@/lib/missio/whatsapp/server";
import type { TemplatesResponse } from "@/lib/missio/whatsapp/types";

// GET /api/missio/whatsapp/templates[?fresh=1]
//
// Missio pastors only. The approved message templates on Missio's WhatsApp
// account, read server-side (the token never reaches the browser). An empty
// list is a real answer: nothing has been approved in Meta yet.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_WHATSAPP_ROLES);
  if ("response" in access) return access.response;

  const config = sendConfig();
  if (!config) {
    const body: TemplatesResponse = { state: "not_configured", templates: [], message: "WhatsApp isn't switched on in the Hub yet." };
    return NextResponse.json(body, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const result = await approvedTemplates(config, { fresh });
  const body: TemplatesResponse = result.ok
    ? { state: "ok", templates: result.templates }
    : { state: "error", templates: [], message: "WhatsApp's approved messages didn't load. Try again in a moment." };
  return NextResponse.json(body, { status: result.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}
