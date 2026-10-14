import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";
import { searchPickableContacts } from "@/services/campaigns";

// GET /api/campaigns/contact-search?q=… — contacts to hand-pick onto a
// campaign (migration 234), each flagged with why it can't be emailed.
export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ contacts: [] });
  const contacts = await searchPickableContacts(supabase, q);
  return NextResponse.json({ contacts });
}
