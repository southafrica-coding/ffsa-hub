import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getDepartmentBySlug } from "./repository";
import type { DepartmentRecord } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export function notAuthenticated() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export function notAuthorized() {
  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}

export type DepartmentContext = {
  supabase: Client;
  admin: Client;
  userId: string;
  department: DepartmentRecord;
};

/**
 * Authenticated caller plus the ministry for this slug.
 * Unknown slug is 404. The caller still has to pass a gate — this does not
 * decide whether they may see the department.
 */
export async function loadDepartment(
  slug: string
): Promise<{ response: NextResponse } | DepartmentContext> {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { response: notAuthenticated() };

  const admin = createAdminClient();
  const found = await getDepartmentBySlug(admin, slug);
  if (found.error) return { response: serverError(found.error.message) };
  if (!found.data) return { response: notFound("Department not found") };
  return { supabase, admin, userId: user.id, department: found.data };
}

export function isDepartmentContext(
  result: { response: NextResponse } | DepartmentContext
): result is DepartmentContext {
  return !("response" in result);
}
