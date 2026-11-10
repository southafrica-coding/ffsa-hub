import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { accountIsActive } from "@/lib/auth/grant-scope";
import {
  accessFlags,
  canOpenDepartment,
  canSeeBudget,
  canSeeDepartmentDetail,
  loadDepartmentGate,
  type DepartmentAccessFlags,
  type DepartmentGate,
} from "./access";
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
  admin: Client;
  userId: string;
  department: DepartmentRecord;
};

export async function loadDepartment(
  slug: string
): Promise<{ response: NextResponse } | DepartmentContext> {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { response: notAuthenticated() };

  const admin = createAdminClient();
  const found = await resolveHome(admin, slug);
  if (found.error) return { response: serverError(found.error) };
  if (!found.data) return { response: notFound("Department not found") };
  return { supabase, admin, userId: user.id, department: found.data };
}

export function isDepartmentContext(
  result: { response: NextResponse } | DepartmentContext
): result is DepartmentContext {
  return !("response" in result);
}

export type OpenedDepartment = DepartmentContext & {
  gate: DepartmentGate;
  access: DepartmentAccessFlags;
};

/** detail: people/OKRs/rocks. budget: budget routes. any: the home itself. */
export async function openDepartment(
  slug: string,
  need: "detail" | "budget" | "any"
): Promise<{ response: NextResponse } | OpenedDepartment> {
  const ctx = await loadDepartment(slug);
  if (!isDepartmentContext(ctx)) return ctx;
  const gate = await loadDepartmentGate(ctx.supabase, ctx.userId);
  if (!gate) {
    if (await accountIsActive(ctx.supabase, ctx.userId)) return { response: serverError("access lookup failed") };
    return { response: notFound("Department not found") };
  }
  const detail = canSeeDepartmentDetail(gate, ctx.department.id);
  const budget = canSeeBudget(gate, ctx.department.id);
  const allowed = need === "detail" ? detail : need === "budget" ? budget : detail || budget || canOpenDepartment(gate, ctx.department.id);
  if (!allowed) return { response: notFound("Department not found") };
  return { ...ctx, gate, access: accessFlags(gate, ctx.department.id) };
}

export function isOpened(result: { response: NextResponse } | OpenedDepartment): result is OpenedDepartment {
  return !("response" in result);
}
