import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  freeCount,
  getEquipmentSettings,
  getOrderById,
  insertEquipmentEvent,
  listActiveMinistries,
  listActivePrograms,
  listBorrowableProducts,
  placeOrder,
  setOrderSchool,
  type EquipmentOrderFull,
  type EquipmentSettings,
} from "@/services/equipment";
import { readCartInput } from "@/lib/equipment/checkout-server";
import { quote, type QuoteProduct } from "@/lib/equipment/pricing";
import { DEFAULT_SETTINGS } from "@/lib/equipment/storefront";
import { sendRequestReceived } from "@/lib/equipment/emails";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Borrowable = QuoteProduct & { name: string; brand: string | null; model: string | null; max_per_order: number | null };

// POST /api/equipment/borrow — the internal borrow form (/bookings/borrow).
// Any signed-in user, for a school or a ministry. Internal rate, no deposit,
// no payment: the order is 'requested' and waits for the inventory manager,
// exactly like a ministry request from the store cart (380). Personal hires
// go through the public store at the public price.
//
// Body: { from, to, lines: [{productId, quantity}], forType: "ministry"|"school",
//         forId, purpose, phone?, collectTime?, returnTime?, notes? }
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Sign in to borrow equipment." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const cart = readCartInput(body);
  if ("error" in cart) {
    return NextResponse.json({ error: cart.error.replace("Your cart is empty.", "Pick at least one item.") }, { status: 400 });
  }

  // Who it's for
  const forType = body.forType;
  const forId = str(body.forId, 40);
  if (forType !== "ministry" && forType !== "school") {
    return NextResponse.json({ error: "Say whether it's for a school or a ministry." }, { status: 400 });
  }
  const [ministriesRes, programsRes] = await Promise.all([listActiveMinistries(supabase), listActivePrograms(supabase)]);
  const options = ((forType === "ministry" ? ministriesRes.data : programsRes.data) ?? []) as { id: string; name: string }[];
  const target = options.find((o) => o.id === forId);
  if (!target) {
    return NextResponse.json({ error: forType === "ministry" ? "Pick the ministry this is for." : "Pick the school this is for." }, { status: 400 });
  }

  const purpose = str(body.purpose, 120);
  if (!purpose) return NextResponse.json({ error: "Say what it's for, like “DTS outreach dinner”." }, { status: 400 });
  const phone = str(body.phone, 30);
  const collectTime = str(body.collectTime, 5);
  const returnTime = str(body.returnTime, 5);
  if ((collectTime && !TIME.test(collectTime)) || (returnTime && !TIME.test(returnTime))) {
    return NextResponse.json({ error: "Times look like 09:30." }, { status: 400 });
  }
  const notes = str(body.notes, 1000);

  // Price and check every line on the server.
  const [productsRes, settingsRes] = await Promise.all([listBorrowableProducts(supabase), getEquipmentSettings(supabase)]);
  if (productsRes.error) return NextResponse.json({ error: productsRes.error.message }, { status: 500 });
  const byId = new Map(((productsRes.data ?? []) as Borrowable[]).map((p) => [p.id, p]));
  const settings = (settingsRes.data as EquipmentSettings | null) ?? DEFAULT_SETTINGS;

  for (const l of cart.lines) {
    const p = byId.get(l.productId);
    if (!p) return NextResponse.json({ error: "Something you picked can't be borrowed any more. Reload the page." }, { status: 400 });
    if (p.max_per_order && l.quantity > p.max_per_order) {
      return NextResponse.json({ error: `At most ${p.max_per_order} ${p.name} per request.` }, { status: 400 });
    }
    const { data: free } = await freeCount(supabase, p.id, cart.from, cart.to);
    if ((free ?? 0) < l.quantity) {
      return NextResponse.json(
        { error: `Only ${free ?? 0} ${p.name} ${free === 1 ? "is" : "are"} free on those dates.` },
        { status: 409 }
      );
    }
  }
  const q = quote(
    cart.lines.map((l) => ({ product: byId.get(l.productId)!, quantity: l.quantity })),
    cart.from,
    cart.to,
    "internal",
    settings
  );

  const { data: profile } = await supabase.from("users").select("display_name").eq("id", user.id).maybeSingle();
  const name = ((profile?.display_name as string | null) ?? "").trim() || user.email || "Hub user";

  const admin = createAdminClient();
  const { data: row, error: placeErr } = await placeOrder(
    admin,
    {
      kind: "internal",
      status: "requested",
      customer_user_id: user.id,
      customer_name: name,
      customer_email: user.email ?? "",
      customer_phone: phone,
      customer_org: target.name,
      ministry_id: forType === "ministry" ? target.id : null,
      purpose,
      starts_on: cart.from,
      ends_on: cart.to,
      collect_time: collectTime,
      return_time: returnTime,
      rate_period: q.period,
      fulfilment: "collect",
      subtotal_cents: q.subtotalCents,
      total_cents: q.subtotalCents,
      deposit_cents: 0,
      notes,
      created_by: user.id,
    },
    q.lines.map((l) => ({
      product_id: l.productId,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      deposit_cents: 0,
      line_total_cents: l.lineTotalCents,
    })),
    []
  );
  if (placeErr || !row) {
    const m = placeErr && /EQUIPMENT_NOT_FREE:([0-9a-f-]+):(\d+)/.exec(placeErr.message);
    if (m) {
      const p = byId.get(m[1]);
      return NextResponse.json(
        { error: `Someone booked ${p?.name ?? "an item"} just now. Only ${m[2]} free. Change the number and send again.` },
        { status: 409 }
      );
    }
    console.error("[equipment/borrow] place order failed:", placeErr?.message);
    return NextResponse.json({ error: "We couldn't send the request. Try again in a moment." }, { status: 500 });
  }

  // equipment_place_order (380) doesn't know about schools; set it after.
  if (forType === "school") {
    await setOrderSchool(admin, row.id, target.id);
  }

  await insertEquipmentEvent(admin, {
    order_id: row.id,
    kind: "requested",
    detail: `Borrow request sent by ${name} for ${target.name}.`,
    actor_id: user.id,
  });
  const { data: full } = await getOrderById(admin, row.id);
  if (full) await sendRequestReceived(full as EquipmentOrderFull);

  return NextResponse.json({ success: true, number: row.number, orderUrl: `/hire/o/${row.access_token}` });
}
