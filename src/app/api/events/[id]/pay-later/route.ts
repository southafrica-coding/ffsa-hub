import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { updateEvent } from "@/services/events";
import {
  createXeroEventItem,
  listXeroItems,
  type XeroItemSummary,
} from "@/services/xero";
import { suggestItemCode, xeroRegionForCurrency } from "@/lib/ticketing/pay-later";

// /api/events/[id]/pay-later — the "Invoice me, pay later" switch.
//
// GET   → current settings + the event's Xero Item: the stored code if it
//         exists in the org, else an item whose name matches the event title
//         (offered, not assumed), plus a suggested code for a new one.
// PATCH → { enabled?, due_date?, item_code?, create_item? }
//         create_item makes the Item in Xero (Event Registration Revenue,
//         tax exempt) before saving the code. Switching on requires an item
//         that really exists in the event's org.

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

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

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { event } = g;
  const region = xeroRegionForCurrency(event.currency);

  let items: XeroItemSummary[] = [];
  let xeroError: string | null = null;
  try {
    items = await listXeroItems(createAdminClient(), region);
  } catch (err) {
    xeroError = err instanceof Error ? err.message : "Couldn't read Xero";
  }
  const item = event.xero_item_code
    ? items.find((i) => norm(i.code) === norm(event.xero_item_code)) ?? null
    : null;
  const match = !item
    ? items.find((i) => norm(i.name) === norm(event.title) || norm(i.description) === norm(event.title)) ?? null
    : null;

  let suggested = suggestItemCode(event.title);
  const taken = new Set(items.map((i) => norm(i.code)));
  for (let n = 2; taken.has(norm(suggested)) && n < 100; n++) suggested = `${suggestItemCode(event.title)}-${n}`;

  return NextResponse.json({
    enabled: event.pay_later_enabled,
    due_date: event.pay_later_due_date,
    item_code: event.xero_item_code,
    region,
    item,
    match,
    suggested_code: suggested,
    xero_error: xeroError,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { supabase, event } = g;
  const region = xeroRegionForCurrency(event.currency);

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
  let linkedOrCreated: "linked" | "created" | null = null;
  if (body.create_item) {
    if (!itemCode) return NextResponse.json({ error: "Enter a code for the Xero item." }, { status: 400 });
    // A code that already exists in the org is linked, not re-created.
    let existing: XeroItemSummary | undefined;
    try {
      existing = (await listXeroItems(admin, region)).find((i) => norm(i.code) === norm(itemCode));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read Xero" }, { status: 502 });
    }
    if (existing) {
      itemCode = existing.code;
      patch.xero_item_code = existing.code;
      linkedOrCreated = "linked";
    } else {
      const created = await createXeroEventItem(admin, region, {
        code: itemCode,
        name: event.title,
        description: event.title,
      });
      if (!created.ok) {
        return NextResponse.json({ error: created.error, needs_reconnect: created.needsReconnect ?? false }, { status: 502 });
      }
      linkedOrCreated = "created";
    }
  }

  if (typeof body.enabled === "boolean") {
    if (body.enabled) {
      if (!itemCode) {
        return NextResponse.json({ error: "Link or create the event's Xero item before switching this on." }, { status: 400 });
      }
      try {
        const items = await listXeroItems(admin, region);
        if (!items.some((i) => norm(i.code) === norm(itemCode))) {
          return NextResponse.json(
            { error: `There's no item "${itemCode}" in the ${region.toUpperCase()} Xero org.` },
            { status: 400 }
          );
        }
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read Xero" }, { status: 502 });
      }
    }
    patch.pay_later_enabled = body.enabled;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, item: linkedOrCreated });
  const { error } = await updateEvent(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: linkedOrCreated });
}
