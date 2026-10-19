import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getEquipmentAccess, updateEquipmentSettings, type EquipmentSettings } from "@/services/equipment";

const INT_FIELDS: { key: keyof EquipmentSettings; min: number; max: number; label: string }[] = [
  { key: "vat_bps", min: 0, max: 5000, label: "VAT" },
  { key: "waiver_bps", min: 0, max: 5000, label: "Waiver" },
  { key: "waiver_cover_cents", min: 0, max: 100_000_000, label: "Waiver cover" },
  { key: "deposit_refund_days", min: 0, max: 60, label: "Deposit refund days" },
];

// PATCH /api/equipment/settings — the Pricing page. Rental manager only.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) {
    return NextResponse.json({ error: "Only the rental manager can change pricing." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const patch: Partial<EquipmentSettings> = {};
  for (const f of INT_FIELDS) {
    if (!(f.key in body)) continue;
    const v = body[f.key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < f.min || v > f.max) {
      return NextResponse.json({ error: `${f.label} is out of range` }, { status: 400 });
    }
    (patch as Record<string, unknown>)[f.key] = v;
  }
  if ("agreement_version" in body) {
    const v = body.agreement_version;
    if (typeof v !== "string" || !v.trim() || v.length > 40) {
      return NextResponse.json({ error: "Agreement version can't be empty" }, { status: 400 });
    }
    patch.agreement_version = v.trim();
  }
  if ("xero_item_code" in body) {
    const v = body.xero_item_code;
    if (v !== null && (typeof v !== "string" || v.length > 30)) {
      return NextResponse.json({ error: "Xero item code is too long" }, { status: 400 });
    }
    patch.xero_item_code = typeof v === "string" && v.trim() ? v.trim() : null;
  }

  const { data, error } = await updateEquipmentSettings(supabase, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, settings: data });
}
