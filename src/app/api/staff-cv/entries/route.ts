import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canAddCvEntry } from "@/lib/auth/check-cv-access";
import { createCvEntry } from "@/services/staff-cv";
import { CV_ENTRY_CATEGORIES, type CvEntryCategory } from "@/lib/users/cv-entry-types";

const VALID_CATEGORIES = new Set(CV_ENTRY_CATEGORIES.map((c) => c.value));

// POST /api/staff-cv/entries — add a CV entry to a staff member's card.
// scope 'self' (default): the card owner, or admin on their behalf.
// scope 'leadership': any Leadership Team member, or admin.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const targetUserId = typeof body.userId === "string" ? body.userId : user.id;
  const category = body.category as CvEntryCategory;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const startDate = typeof body.startDate === "string" ? body.startDate.trim() : "";
  const endDate = typeof body.endDate === "string" ? body.endDate.trim() : "";
  const scope = body.scope === "leadership" ? "leadership" : "self";

  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "Please enter a title" }, { status: 400 });
  }
  if (startDate && endDate && endDate < startDate) {
    return NextResponse.json({ error: "The end date can't be before the start date" }, { status: 400 });
  }

  if (!(await canAddCvEntry(supabase, user.id, targetUserId, scope))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Self-scope writes by the owner satisfy RLS directly; every other case
  // (admin on-behalf, leadership adding to someone else's card) is
  // authorized above and written via the service-role client.
  const client = scope === "self" && targetUserId === user.id ? supabase : createAdminClient();
  const { data, error } = await createCvEntry(client, {
    userId: targetUserId,
    category,
    title,
    description,
    startDate,
    endDate,
    scope,
    createdBy: user.id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
}
