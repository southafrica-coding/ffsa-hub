import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getHouseholdMembers,
  createHouseholdMember,
} from "@/services/household";
import {
  sanitizeHouseholdInput,
  getOwnMaritalStatus,
} from "@/lib/users/household-input";
import { householdRelationshipError } from "@/lib/users/marital-status";

// GET /api/profile/household — list the caller's family members.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Hide the caller's own identity row: once a spouse has their own Hub
  // account they maintain those details on their profile, not as a family
  // member of themselves. Their spouse still sees the row.
  const { data, error } = await getHouseholdMembers(supabase, user.id, {
    excludeLinkedUserId: user.id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ members: data ?? [] });
}

// POST /api/profile/household — add a family member owned by the caller.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { input, error: validationError } = sanitizeHouseholdInput(body, {
    requireCore: true,
  });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // No spouse record for someone who isn't married (marital-status.ts).
  const relationshipError = householdRelationshipError(
    input.relationship,
    await getOwnMaritalStatus(supabase, user.id)
  );
  if (relationshipError) {
    return NextResponse.json({ error: relationshipError }, { status: 400 });
  }

  const { data, error } = await createHouseholdMember(supabase, user.id, input);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: data });
}
