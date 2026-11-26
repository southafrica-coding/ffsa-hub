// ────────────────────────────────────────────────────────────
// Missio WhatsApp — server wiring shared by the routes
// ────────────────────────────────────────────────────────────
// Server only. Builds the real dependencies (service-role store, Graph,
// the cached template list) so the routes stay thin and the logic in
// send.ts / inbox.ts / webhook.ts stays testable with fakes.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPerson } from "@/lib/missio/people";
import type { OrgAccess } from "@/lib/missio/access";
import { sendConfig, type SendConfig } from "./config";
import { listApprovedTemplates } from "./graph";
import type { TemplateView } from "./rules";
import type { ThreadDeps } from "./inbox";
import type { WhatsAppErrorCode } from "./types";

/** Who may use the inbox. Same gate as Finance: Missio pastors only. */
export const MISSIO_WHATSAPP_ROLES = ["pastor"] as const;

export function whatsAppError(status: number, code: WhatsAppErrorCode, error: string) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

// Templates change rarely; reading them at most every five minutes keeps
// the composer quick without a stale list lasting long after an approval.
const TEMPLATE_TTL_MS = 5 * 60 * 1000;
let templateCache: { at: number; wabaId: string; templates: TemplateView[] } | null = null;

export async function approvedTemplates(config: SendConfig, options?: { fresh?: boolean }): Promise<{ ok: true; templates: TemplateView[] } | { ok: false }> {
  if (!options?.fresh && templateCache && templateCache.wabaId === config.wabaId && Date.now() - templateCache.at < TEMPLATE_TTL_MS) {
    return { ok: true, templates: templateCache.templates };
  }
  const result = await listApprovedTemplates(config);
  if (!result.ok) {
    console.error("[missio-whatsapp] templates failed", result.error.code ?? "no code");
    return { ok: false };
  }
  templateCache = { at: Date.now(), wabaId: config.wabaId, templates: result.templates };
  return { ok: true, templates: result.templates };
}

export function isSendReady(): boolean {
  return sendConfig() !== null;
}

/** contacts.phone through the service role. Only call after requireOrgRole passed. */
export async function readContactPhone(contactId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const found = await admin.from("contacts").select("phone").eq("id", contactId).maybeSingle();
    if (found.error) {
      console.error("[missio-whatsapp] contact phone failed", found.error.code ?? "db error");
      return null;
    }
    return (found.data as { phone?: string | null } | null)?.phone?.trim() || null;
  } catch {
    console.error("[missio-whatsapp] admin client unavailable");
    return null;
  }
}

export function threadDeps(access: OrgAccess): ThreadDeps {
  return {
    supabase: access.supabase,
    orgId: access.orgId,
    sendReady: isSendReady(),
    async loadPerson(personId) {
      const found = await loadPerson(access.supabase, access.orgId, personId);
      if ("error" in found) return { status: found.status };
      return { contactId: found.person.contactId, name: found.person.name };
    },
    readPhone: readContactPhone,
  };
}
