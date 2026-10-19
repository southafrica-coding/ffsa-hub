import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canBookInternally, checkCart, readCartInput } from "@/lib/equipment/checkout-server";
import { listActiveMinistries } from "@/services/equipment";

// POST /api/equipment/cart — public. Re-checks a browser cart against the
// chosen dates (spec rule 4): what fits, what's short, a swap where there is
// one, and the totals so far. Body: { from, to, lines, internal? }.
// A signed-in visitor also gets their name and email to prefill checkout,
// and ministry bookers the list of ministries to book for.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const input = readCartInput(body);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const internalAllowed = user ? await canBookInternally(supabase) : false;
  const wantsInternal = (body as { internal?: unknown }).internal === true;
  const checked = await checkCart(supabase, input, internalAllowed && wantsInternal ? "internal" : "external");

  let me: { name: string; email: string } | null = null;
  if (user) {
    const { data: profile } = await supabase.from("users").select("display_name").eq("id", user.id).maybeSingle();
    me = { name: (profile?.display_name as string | null) ?? "", email: user.email ?? "" };
  }
  const ministries = internalAllowed ? ((await listActiveMinistries(supabase)).data ?? []) : [];

  return NextResponse.json({ ...checked, internalAllowed, me, ministries });
}
