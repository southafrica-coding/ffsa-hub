// Opens the Song Library for the signed-in caller: the session client (so
// 419's RLS applies to every read and write), the active-account gate, and
// who the caller is (SongLibraryViewer). No department is named here: the
// managing and owning ministries come from service_owners rows on the
// song_library service.

import "server-only";

import type { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized } from "@/lib/departments/http";
import { rpcFlag } from "@/lib/departments/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SongLibraryViewer } from "@/lib/song-library/access";
import { SONG_LIBRARY_SERVICE_KEY, type Client } from "@/lib/song-library/types";

export type SongLibraryContext = {
  supabase: Client;
  /** Service role. Only for storage signing, display names and DMs, after the caller passed the gate. */
  admin: Client;
  viewer: SongLibraryViewer;
};

/**
 * The ministries whose leaders count as the service's "department leaders
 * and overseers": every ministry with an own or manage grant on
 * song_library.
 */
export async function owningMinistryIds(supabase: Client): Promise<{ ok: true; ids: string[] } | { ok: false }> {
  const rows = await supabase
    .from("service_owners")
    .select("staff_ministry_id, capability, open_to_all")
    .eq("service_key", SONG_LIBRARY_SERVICE_KEY)
    .in("capability", ["own", "manage"]);
  if (rows.error) return { ok: false };
  const ids = new Set<string>();
  for (const r of (rows.data ?? []) as { staff_ministry_id: string | null; open_to_all: boolean | null }[]) {
    if (r.staff_ministry_id && !r.open_to_all) ids.add(r.staff_ministry_id);
  }
  return { ok: true, ids: [...ids] };
}

export async function loadViewer(supabase: Client, userId: string): Promise<{ ok: true; viewer: SongLibraryViewer; canRead: boolean } | { ok: false }> {
  const [read, manage, admin, owners] = await Promise.all([
    rpcFlag(supabase, "song_library_can_read"),
    rpcFlag(supabase, "song_library_can_manage"),
    rpcFlag(supabase, "song_library_is_admin"),
    owningMinistryIds(supabase),
  ]);
  if (!read.ok || !manage.ok || !admin.ok || !owners.ok) return { ok: false };
  let isLead = admin.value;
  if (!isLead && owners.ids.length) {
    const leads = await Promise.all(owners.ids.map((id) => rpcFlag(supabase, "dept_is_ministry_leader", { p_ministry_id: id })));
    if (leads.some((l) => !l.ok)) return { ok: false };
    isLead = leads.some((l) => l.ok && l.value);
  }
  return {
    ok: true,
    canRead: read.value,
    viewer: { userId, isAdmin: admin.value, canManage: manage.value, isLead },
  };
}

/** 401 signed out, 403 inactive or no Song Library access. */
export async function openSongLibrary(): Promise<{ response: NextResponse } | SongLibraryContext> {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { response: notAuthenticated() };
  if (!(await accountIsActive(supabase, user.id))) return { response: notAuthorized() };
  const loaded = await loadViewer(supabase, user.id);
  if (!loaded.ok || !loaded.canRead) return { response: notAuthorized() };
  return { supabase, admin: createAdminClient(), viewer: loaded.viewer };
}

export function isOpen(r: { response: NextResponse } | SongLibraryContext): r is SongLibraryContext {
  return !("response" in r);
}
