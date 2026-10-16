import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageComms } from "@/lib/api-auth";
import { createAuditLog } from "@/services/audit";
import { addSendingDomain, syncDomainsFromResend, verifySendingDomain } from "@/services/sending-domains";

// /api/communications/domains — Communications → Sending domains (migration 243).
//
// GET  → every domain, freshly read from Resend: status + the DNS records.
// POST { domain }            → add it to Resend; returns its records.
// POST { id, action: "verify" } → ask Resend to check the DNS now.

export const maxDuration = 60;

async function guard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await canManageComms(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Communications access required" }, { status: 403 }) };
  }
  return { supabase, admin: createAdminClient() };
}

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  const { rows, error } = await syncDomainsFromResend(g.admin);
  return NextResponse.json({ domains: rows, error });
}

export async function POST(request: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const b = await request.json().catch(() => ({}));
  try {
    if (b.action === "verify") {
      if (typeof b.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
      const row = await verifySendingDomain(g.admin, b.id);
      return NextResponse.json({ domain: row });
    }
    if (typeof b.domain !== "string") return NextResponse.json({ error: "Enter a domain" }, { status: 400 });
    const row = await addSendingDomain(g.admin, b.domain);
    await createAuditLog(g.supabase, {
      action: "communications.sending_domain_added",
      resource_type: "sending_domain",
      resource_id: row.id,
      changes: { domain: row.domain, resend_domain_id: row.resend_domain_id },
    });
    return NextResponse.json({ domain: row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}
