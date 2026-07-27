import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getAllListOptions } from "@/services/list-options";

// GET /api/list-options[?keys=gender,relationship]
// Active options only, grouped by list_key. Any signed-in user may read —
// these drive dropdowns in onboarding and profile forms.
export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await getAllListOptions(supabase);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const keysParam = new URL(request.url).searchParams.get("keys");
  const wanted = keysParam ? new Set(keysParam.split(",").map((k) => k.trim())) : null;

  const lists: Record<string, { value: string; label: string }[]> = {};
  for (const [key, options] of Object.entries(data ?? {})) {
    if (wanted && !wanted.has(key)) continue;
    lists[key] = options
      .filter((o) => o.is_active)
      .map((o) => ({ value: o.value, label: o.label }));
  }

  return NextResponse.json({ lists });
}
