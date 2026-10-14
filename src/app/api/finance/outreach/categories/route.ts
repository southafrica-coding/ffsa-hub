import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/finance/outreach-budget";

// Add a custom outreach budget category. Categories are shared by every
// team. Asking for a name that already exists (any casing) hands back the
// existing one rather than making a near-duplicate.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { name: raw } = (await request.json()) as { name?: string };
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return NextResponse.json({ error: "Give the category a name" }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "Keep the name under 60 characters" }, { status: 400 });

  const { data: all, error: readError } = await supabase
    .from("outreach_budget_categories")
    .select("id, name, slug, sort_order");
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const existing = (all ?? []).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return NextResponse.json({ success: true, category: existing, existed: true });

  const base = slugify(name) || "category";
  const taken = new Set((all ?? []).map((c) => c.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  const sortOrder = Math.max(0, ...(all ?? []).map((c) => c.sort_order ?? 0)) + 1;

  const { data, error } = await supabase
    .from("outreach_budget_categories")
    .insert({ name, slug, sort_order: sortOrder, is_default: false, created_by: user.id })
    .select("id, name, slug, sort_order")
    .single();

  if (error) {
    const forbidden = error.code === "42501" || /row-level security/i.test(error.message);
    return NextResponse.json(
      { error: forbidden ? "You don't have permission to add categories" : error.message },
      { status: forbidden ? 403 : 400 }
    );
  }
  return NextResponse.json({ success: true, category: data });
}
