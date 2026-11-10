// Shared plumbing for the /api/evangelism routes: who is calling, what they
// may do, and how errors come back (clean 401/403/404, 503 before migration
// 307 is applied, never a raw PostgREST dump).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEvangelismAccess, type EvangelismAccess } from "@/lib/auth/check-evangelism-access";
import { moderatorWithheldClientMessage } from "@/lib/evangelism/takedown";
import {
  getAttribution,
  isEvangelismNotReady,
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
  const code = (error as { code?: string; message?: unknown } | null)?.code;
  if (code === "42501") {
    const friendly = moderatorWithheldClientMessage(error && (error as { message?: unknown }).message);
    return jsonError(403, friendly ?? "You don't have permission to do that.");
  }
  if (code === "23514") return jsonError(400, "That story doesn't pass the checks (consent, numbers or lengths).");
  return jsonError(500, "Something went wrong saving the story.");
}

/**
 * Turn rows the caller already passed RLS for into API shapes. Attribution
 * comes from the RPC on the caller's OWN client (the database decides who
 * may see names). Photo URLs are signed with the service role, keyed by
 * media ids taken from those same RLS rows.
 */
export async function present(rows: TestimonyRow[], caller: Caller): Promise<PresentedTestimony[]> {
  const { data: attribution, error } = await getAttribution(
    caller.supabase,
    rows.map((r) => r.id)
  );
  if (error) console.error("[evangelism] attribution failed", error);
  let signed = new Map<string, string>();
  try {
    signed = await signPhotoUrls(createAdminClient(), rows);
  } catch (e) {
    // Missing service-role env or a Storage hiccup: still return the text.
    console.error("[evangelism] signing failed", e);
  }
  const moderate = (caller.access as { moderate?: boolean }).moderate === true;
  return rows.map((r) => presentTestimony(r, attribution.get(r.id), signed, { moderate }));
}
