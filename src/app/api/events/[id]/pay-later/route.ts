import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { updateEvent } from "@/services/events";
import {
  createXeroEventItem,
  listXeroItems,
  type XeroItemSummary,
  type XeroRegion,
} from "@/services/xero";
import { suggestItemCode } from "@/lib/ticketing/pay-later";

// /api/events/[id]/pay-later — the "Invoice me, pay later" switch.
//
// Invoices go to the Xero org of the BUYER'S country, as in Training: USA →
// the US org, everyone else → the SA org (getXeroRegionForStudent). So the
// event's item (one code) has to exist in BOTH orgs.
//
// GET   → current settings + per org: the stored code's item if it exists
//         there, else an item whose name matches the event title (offered,
//         not assumed), plus a suggested code for a new one.
// PATCH → { enabled?, due_date?, item_code?, create_item? }
//         create_item links the code in each org where it exists and creates
//         it (Event Registration Revenue, tax exempt) where it doesn't.
//         Switching on requires the item in both orgs.

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const REGIONS: XeroRegion[] = ["za", "us"];

async function guard(eventId: string) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await canManageEvents(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  const { data: event } = await supabase
    .from("events")
    .select("id, title, currency, pay_later_enabled, pay_later_due_date, xero_item_code")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { error: NextResponse.json({ error: "Event not found" }, { status: 404 }) };
  return { supabase, event };
}

async function itemsByRegion(admin: ReturnType<typeof createAdminClient>) {
  const out = {} as Record<XeroRegion, { items: XeroItemSummary[]; error: string | null }>;
  await Promise.all(
    REGIONS.map(async (r) => {
      try {
        out[r] = { items: await listXeroItems(admin, r), error: null };
      } catch (err) {
        out[r] = { items: [], error: err instanceof Error ? err.message : "Couldn't read Xero" };
      }
    })
  );
  return out;
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { event } = g;

  const all = await itemsByRegion(createAdminClient());
  const orgs = REGIONS.map((region) => {
    const { items, error } = all[region];
    const item = event.xero_item_code
      ? items.find((i) => norm(i.code) === norm(event.xero_item_code)) ?? null
      : null;
    const match = !item
      ? items.find((i) => norm(i.name) === norm(event.title) || norm(i.description) === norm(event.title)) ?? null
      : null;
    return { region, item, match, xero_error: error };
  });

  // A code free in both orgs, so one code works everywhere.
  const taken = new Set(REGIONS.flatMap((r) => all[r].items.map((i) => norm(i.code))));
  let suggested = suggestItemCode(event.title);
  for (let n = 2; taken.has(norm(suggested)) && n < 100; n++) suggested = `${suggestItemCode(event.title)}-${n}`;

  return NextResponse.json({
    enabled: event.pay_later_enabled,
    due_date: event.pay_later_due_date,
    item_code: event.xero_item_code,
    orgs,
    suggested_code: suggested,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { supabase, event } = g;

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    due_date?: string | null;
    item_code?: string | null;
    create_item?: boolean;
  };
  const patch: Record<string, unknown> = {};
  if (body.due_date !== undefined) {
    if (body.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) {
      return NextResponse.json({ error: "Due date must be YYYY-MM-DD." }, { status: 400 });
    }
    patch.pay_later_due_date = body.due_date;
  }

  let itemCode = event.xero_item_code as string | null;
  if (body.item_code !== undefined) {
    itemCode = body.item_code?.trim() || null;
    if (itemCode && itemCode.length > 30) {
      return NextResponse.json({ error: "Xero item codes are at most 30 characters." }, { status: 400 });
    }
    patch.xero_item_code = itemCode;
  }

  const admin = createAdminClient();
  const outcome: Partial<Record<XeroRegion, "linked" | "created">> = {};
  if (body.create_item) {
    if (!itemCode) return NextResponse.json({ error: "Enter a code for the Xero item." }, { status: 400 });
    const all = await itemsByRegion(admin);
    for (const region of REGIONS) {
      if (all[region].error) {
        return NextResponse.json({ error: `${region.toUpperCase()} Xero: ${all[region].error}` }, { status: 502 });
      }
      // A code that already exists in the org is linked, not re-created.
      if (all[region].items.some((i) => norm(i.code) === norm(itemCode))) {
        outcome[region] = "linked";
        continue;
      }
      const created = await createXeroEventItem(admin, region, {
        code: itemCode,
        name: event.title,
        description: event.title,
      });
      if (!created.ok) {
        // Save the code anyway so the org that worked stays linked.
        await updateEvent(supabase, id, { ...patch, xero_item_code: itemCode });
        return NextResponse.json(
          { error: `${region === "us" ? "US" : "SA"} Xero: ${created.error}`, needs_reconnect: created.needsReconnect ?? false },
          { status: 502 }
        );
      }
      outcome[region] = "created";
    }
    patch.xero_item_code = itemCode;
  }

  if (typeof body.enabled === "boolean") {
    if (body.enabled) {
      if (!itemCode) {
        return NextResponse.json({ error: "Link or create the event's Xero item before switching this on." }, { status: 400 });
      }
      const all = await itemsByRegion(admin);
      for (const region of REGIONS) {
        if (all[region].error) {
          return NextResponse.json({ error: `${region.toUpperCase()} Xero: ${all[region].error}` }, { status: 502 });
        }
        if (!all[region].items.some((i) => norm(i.code) === norm(itemCode))) {
          return NextResponse.json(
            {
              error: `There's no item "${itemCode}" in the ${region === "us" ? "US" : "SA"} Xero org yet — buyers are invoiced in their own country's org, so it's needed in both. Use Link or create.`,
            },
            { status: 400 }
          );
        }
      }
    }
    patch.pay_later_enabled = body.enabled;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, item: outcome });
  const { error } = await updateEvent(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: outcome });
}
