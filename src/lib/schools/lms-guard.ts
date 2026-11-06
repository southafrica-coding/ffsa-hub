import { createClient } from "@/lib/supabase/server";
import { userCanManageApplications, userCanManageProgram } from "@/lib/auth/check-schools-access";
import { json } from "./lms-http";

export async function guardUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { response: json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401) };
  }
  return { supabase, user };
}

export async function guardProgram(programId: string) {
  const guard = await guardUser();
  if ("response" in guard) return guard;
  if (!(await userCanManageProgram(guard.supabase, guard.user.id, programId))) {
    return { response: json({ error: "forbidden", message: "You cannot manage this school." }, 403) };
  }
  return guard;
}

export function isGuard<T extends { response?: unknown }>(result: T): result is T & { response: Response } {
  return "response" in result && result.response != null;
}

export async function canManageSchoolGlobally(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  return userCanManageApplications(supabase, userId);
}
