import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  canInsertEvent,
  isUnscopedAdmin,
  hasUnscopedRole,
  loadEventAccess,
  writeBlocked,
} from "@/lib/auth/event-access";
import { createEvent } from "@/services/events";

// POST /api/events — create a draft event.
//
// 314 events INSERT: unscoped admin / events_admin, an unscoped
// events.create, or created_by = self while holding events.create in any
// scope. A scoped holder cannot create the row as someone else.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    title?: unknown;
    description?: unknown;
    location?: unknown;
    start_date?: unknown;
    end_date?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    max_capacity?: unknown;
    is_public?: unknown;
    registration_required?: unknown;
    created_by?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const startDate = typeof body.start_date === "string" ? body.start_date : "";
  if (!title || !startDate) {
    return NextResponse.json({ error: "Title and start date are required" }, { status: 400 });
  }

  const snap = await loadEventAccess(supabase, user.id);
  const requestedCreator = typeof body.created_by === "string" ? body.created_by : user.id;
  const privileged =
    isUnscopedAdmin(snap) ||
    hasUnscopedRole(snap, ["events_admin"]) ||
    snap.grants.some((g) => g.key === "events.create" && g.scopeType == null && snap.active);
  const createdBy = privileged ? requestedCreator : user.id;
  if (!canInsertEvent(snap, createdBy === user.id)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await createEvent(supabase, {
    title,
    description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
    location: typeof body.location === "string" && body.location.trim() ? body.location.trim() : null,
    start_date: startDate,
    end_date: typeof body.end_date === "string" && body.end_date ? body.end_date : null,
    start_time: typeof body.start_time === "string" && body.start_time ? body.start_time : null,
    end_time: typeof body.end_time === "string" && body.end_time ? body.end_time : null,
    max_capacity: typeof body.max_capacity === "number" ? body.max_capacity : null,
    is_public: body.is_public === true,
    registration_required: body.registration_required !== false,
    created_by: createdBy,
    status: "draft",
  });
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
