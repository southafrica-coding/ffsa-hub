import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { searchLinkableUsers } from "@/services/family";

// GET /api/family/search-users?q=… — controlled directory lookup for the
// spouse picker. Runs server-side with the admin client (the users table is
// own-record + admin under RLS), requires ≥2 chars, and returns only an id,
// display name and masked email so it can't be used to scrape the directory.
export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await searchLinkableUsers(createAdminClient(), user.id, q);
  return NextResponse.json({ results });
}
