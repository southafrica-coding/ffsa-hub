import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import {
  getOrCreateScanLink,
  rotateScanLink,
  setScanLinkActive,
} from "@/services/event-scan-links";

// Mint / rotate / switch off the shareable door link for one event.
// Only staff who could already run the door can hand it out.

async function authorise() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await canManageEvents(supabase, user.id, ["events.manage_attendance"]))) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { userId: user.id };
}

// GET → the current link, minting one on first ask. Fetched on demand so the
// token isn't baked into the HTML of every event page render.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await authorise();
  if ("error" in auth) return auth.error;

  const link = await getOrCreateScanLink(createAdminClient(), id, auth.userId);
  if (!link) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json({
    token: link.token,
    isActive: link.is_active,
    expiresAt: link.expires_at,
  });
}

// POST → rotate. Every copy of the old URL stops working immediately.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await authorise();
  if ("error" in auth) return auth.error;

  const link = await rotateScanLink(createAdminClient(), id, auth.userId);
  if (!link) {
    return NextResponse.json({ error: "Could not rotate the link" }, { status: 500 });
  }
  return NextResponse.json({
    token: link.token,
    isActive: link.is_active,
    expiresAt: link.expires_at,
  });
}

// PATCH { isActive } → close or re-open the door without changing the URL.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await authorise();
  if ("error" in auth) return auth.error;

  let body: { isActive?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive is required" }, { status: 400 });
  }

  await setScanLinkActive(createAdminClient(), id, body.isActive);
  return NextResponse.json({ isActive: body.isActive });
}
