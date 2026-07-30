import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canViewContacts } from "@/lib/api-auth";
import { resolvePersonQuickView } from "@/services/person-quick-view";

// GET /api/people/quick-view?contactId=… | userId=… | email=…
//
// Data for the person quick-view side panel. Gated on contacts-view
// access (NOT schools access) and deliberately application-free — a
// viewer sees the person's identity, email history and activity, never
// their school application. Reads via the admin client (like the contact
// detail page) after the app-layer permission gate.
export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canViewContacts(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const contactId = url.searchParams.get("contactId");
  const userId = url.searchParams.get("userId");
  const email = url.searchParams.get("email");
  if (!contactId && !userId && !email) {
    return NextResponse.json(
      { error: "One of contactId, userId or email is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const person = await resolvePersonQuickView(admin, {
    contactId,
    userId,
    email,
  });
  return NextResponse.json({ person });
}
