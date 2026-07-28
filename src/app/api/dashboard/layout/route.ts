import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertLayout, deleteLayout } from "@/services/dashboard";
import {
  getPermittedWidgets,
  mergeLayout,
  resolveLayout,
  resolvePermittedWidgets,
  type LayoutEntry,
} from "@/lib/dashboard/widget-registry";
import { buildDashboardContext } from "@/lib/dashboard/context";

// GET — the caller's resolved layout, plus the catalogue of widgets they are
// allowed to use. The Customise panel needs both: the order/toggles, and the
// titles + descriptions to render the picker.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [layout, permitted] = await Promise.all([
    resolveLayout(supabase, user.id),
    resolvePermittedWidgets(supabase, user.id),
  ]);

  return NextResponse.json({
    layout: layout.entries,
    isDefault: layout.isDefault,
    catalogue: permitted.map((w) => ({
      key: w.key,
      title: w.title,
      description: w.description,
      category: w.category,
    })),
  });
}

// PUT — save the caller's layout.
//
// The incoming array is filtered against the widgets this user is actually
// PERMITTED to use, not merely against the registry. That is what stops a
// hand-crafted request from persisting a widget the user has no access to.
// (The widget's own API route would refuse to serve it data anyway — this is
// the belt to that braces.)
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incoming = (body as { layout?: unknown } | null)?.layout;
  if (!Array.isArray(incoming)) {
    return NextResponse.json(
      { error: "layout must be an array of { key, enabled }" },
      { status: 400 }
    );
  }

  const ctx = await buildDashboardContext(supabase, user.id);
  const permitted = getPermittedWidgets(ctx);
  const permittedKeys = new Set(permitted.map((w) => w.key));

  const seen = new Set<string>();
  const cleaned: LayoutEntry[] = [];
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const { key, enabled } = raw as { key?: unknown; enabled?: unknown };
    if (typeof key !== "string") continue;
    // Silently drop unknown / unpermitted / duplicate keys rather than 400 —
    // a stale tab whose registry has moved on should still be able to save.
    if (!permittedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ key, enabled: enabled !== false });
  }

  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: "No valid widgets in layout" },
      { status: 400 }
    );
  }

  const { error } = await upsertLayout(supabase, user.id, cleaned);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return the merged result so the client renders exactly what was stored,
  // including any widget that slotted in at its default position.
  const resolved = mergeLayout(cleaned, permitted, ctx);
  return NextResponse.json({
    success: true,
    layout: resolved.entries,
    isDefault: false,
  });
}

// DELETE — reset to registry defaults by removing the row.
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { error } = await deleteLayout(supabase, user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resolved = await resolveLayout(supabase, user.id);
  return NextResponse.json({
    success: true,
    layout: resolved.entries,
    isDefault: true,
  });
}
