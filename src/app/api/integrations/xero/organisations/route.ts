import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import { listXeroOrganisations, repointRegion, type XeroRegion } from "@/services/xero";

/**
 * Which Xero organisations this app is authorised for, and which region points
 * at which.
 *
 * Xero's consent screen greys out organisations that are already connected and
 * only offers "Continue with N organisations" — so a person cannot pick one per
 * region there. The choice belongs here.
 *
 * GET  — every authorised organisation, with the region currently bound to it.
 * POST — bind a region to a specific tenant id.
 *
 * POST rewrites no tokens. The stored token is authorised for every
 * organisation in the list, so pointing a region at a different tenant is a
 * one-field change, not a reconnection.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await listXeroOrganisations(supabase);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const region = body?.region as XeroRegion | undefined;
  const tenantId = body?.tenantId as string | undefined;

  if (!region || !["za", "us"].includes(region) || !tenantId) {
    return NextResponse.json(
      { error: "region ('za' | 'us') and tenantId are required" },
      { status: 400 }
    );
  }

  const { error, tenantName } = await repointRegion(supabase, region, tenantId);
  if (error) return NextResponse.json({ error }, { status: 400 });

  return NextResponse.json({ ok: true, region, tenantName });
}
