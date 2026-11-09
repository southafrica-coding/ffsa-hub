// Shared plumbing for the /api/evangelism routes: who is calling, what they
// may do, and how errors come back (clean 401/403/404, 503 before migration
// 307 is applied, never a raw PostgREST dump).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEvangelismAccess, type EvangelismAccess } from "@/lib/auth/check-evangelism-access";
import {
  canSeeAttribution,
  isEvangelismNotReady,
  loadAuthorNames,
  presentTestimony,
  signPhotoUrls,
  type PresentedTestimony,
  type TestimonyRow,
} from "@/services/evangelism";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type Caller = { supabase: Client; userId: string; access: EvangelismAccess };

export function jsonError(status: number, error: string, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

/** Signed-in caller plus their evangelism access, or a 401 response. */
export async function getCaller(): Promise<Caller | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError(401, "Not signed in.");
  const access = await getEvangelismAccess(supabase, user.id);
  return { supabase, userId: user.id, access };
}

/** 503 when the tables/bucket are missing, otherwise a generic 500. */
export function dbError(error: unknown, context: string) {
  if (isEvangelismNotReady(error)) {
    return jsonError(503, "Evangelism isn't switched on yet.", "evangelism_not_enabled");
  }
  console.error(`[evangelism] ${context}`, error);
  const code = (error as { code?: string } | null)?.code;
  if (code === "42501") return jsonError(403, "You don't have permission to do that.");
  if (code === "23514") return jsonError(400, "That story doesn't pass the checks (consent, numbers or lengths).");
  return jsonError(500, "Something went wrong saving the story.");
}

/**
 * Turn rows the caller already passed RLS for into API shapes: signed photo
 * URLs, and author names only where the caller may see attribution.
 */
export async function present(rows: TestimonyRow[], caller: Caller): Promise<PresentedTestimony[]> {
  const viewer = { userId: caller.userId, access: caller.access };
  let signed = new Map<string, string>();
  let names = new Map<string, string>();
  try {
    const admin = createAdminClient();
    const attributable = rows.filter((r) => canSeeAttribution(r, viewer)).map((r) => r.author_user_id);
    [signed, names] = await Promise.all([signPhotoUrls(admin, rows), loadAuthorNames(admin, attributable)]);
  } catch (e) {
    // Missing service-role env or a Storage hiccup: still return the text.
    console.error("[evangelism] signing/names failed", e);
  }
  return rows.map((r) => presentTestimony(r, viewer, { signed, names }));
}
