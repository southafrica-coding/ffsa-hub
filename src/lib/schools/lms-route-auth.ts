import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveLmsAccess } from "@/services/lms-content";
import type { LmsAccess } from "@/lib/schools/lms-content";

// Shared gate for /api/schools/programs/[programId]/lms/*.
//   edit → userCanManageProgram (leaders, schools.* managers, admins)
//   read → editors, program staff, or a student enrolled in the program
// Uses the signed-in user's client throughout; RLS (migration 305) repeats
// the same rules. No service-role client on these paths.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type LmsAuthOk = {
  supabase: Supabase;
  userId: string;
  access: LmsAccess;
};

export async function authorizeLms(
  programId: string,
  need: "edit" | "read"
): Promise<LmsAuthOk | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const access = await resolveLmsAccess(supabase, user.id, programId);
  const allowed = need === "edit" ? access.canEdit : access.canReadPublished;
  if (!allowed) {
    return { response: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { supabase, userId: user.id, access };
}

export function notFound(what: string) {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 });
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export function serverError(error: { message: string }) {
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}
