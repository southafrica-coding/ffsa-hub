import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { loadMinistryAccess, type DepartmentAccessFlags } from "./access";
import { foldedTargetSlug, isBlockedHomeSlug } from "./homes";
import {
  getDepartmentById,
  getDepartmentBySlug,
  listAliases,
  type DepartmentRecord,
} from "./repository";

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

/** Clients never see database text. Details go to the server log. */
export function serverError(detail?: unknown) {
  if (detail !== undefined) console.error(detail);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}

export function isDepartmentHome(row: DepartmentRecord): boolean {
  if (!row.is_active) return false;
  if (row.ministry_type === "part_time") return false;
  if (isBlockedHomeSlug(row.slug)) return false;
  return true;
}

/** Fold donors_dev onto finances_legal. Anything in NOT_A_HOME_SLUGS is absent. */
export async function resolveHome(
  supabase: Client,
  slug: string
): Promise<{ data: DepartmentRecord | null; error: { message: string } | null }> {
  const found = await getDepartmentBySlug(supabase, slug);
  if (found.error || !found.data) return found;
  if (isBlockedHomeSlug(found.data.slug) || found.data.ministry_type === "part_time" || !found.data.is_active) {
    return { data: null, error: null };
  }

  const aliases = await listAliases(supabase);
  if (aliases.error) return { data: null, error: aliases.error };
  const alias = aliases.data.find((row) => row.staff_ministry_id === found.data!.id);
  let home = found.data;
  if (alias) {
    const target = await getDepartmentById(supabase, alias.resolves_to_id);
    if (target.error || !target.data) return { data: null, error: target.error };
    home = target.data;
  } else {
    const folded = foldedTargetSlug(found.data.slug);
    if (folded) {
      const target = await getDepartmentBySlug(supabase, folded);
      if (target.error || !target.data) return { data: null, error: target.error };
      home = target.data;
    }
  }
  if (!isDepartmentHome(home)) return { data: null, error: null };
  return { data: home, error: null };
}

export type DepartmentContext = {
  supabase: Client;
  admin: Client | null;
  userId: string;
  department: DepartmentRecord;
};

export async function loadDepartment(
  slug: string
): Promise<{ response: NextResponse } | DepartmentContext> {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { response: notAuthenticated() };
  if (!(await accountIsActive(supabase, user.id))) return { response: notAuthorized() };

  const found = await resolveHome(supabase, slug);
  if (found.error) return { response: notAuthorized() };
  if (!found.data) return { response: notFound("Department not found") };
  return { supabase, admin: null, userId: user.id, department: found.data };
}

export function isDepartmentContext(
  result: { response: NextResponse } | DepartmentContext
): result is DepartmentContext {
  return !("response" in result);
}

export type OpenedDepartment = Omit<DepartmentContext, "admin"> & {
  admin: Client;
  access: DepartmentAccessFlags;
};

/** detail: people/OKRs/rocks. budget: budget routes. any: the home itself. */
export async function openDepartment(
  slug: string,
  need: "detail" | "budget" | "any"
): Promise<{ response: NextResponse } | OpenedDepartment> {
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx;
  const decision = await loadMinistryAccess(ctx.supabase, ctx.department.id);
  if (!decision.ok) return { response: notAuthorized() };
  const allowed =
    need === "detail"
      ? decision.access.canSeeDepartmentDetail
      : need === "budget"
        ? decision.access.canSeeBudget
        : !decision.denied;
  if (!allowed) return { response: notFound("Department not found") };
  return { ...ctx, admin: createAdminClient(), access: decision.access };
}

export function isOpened(result: { response: NextResponse } | OpenedDepartment): result is OpenedDepartment {
  return !("response" in result);
}
