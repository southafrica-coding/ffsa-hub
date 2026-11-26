// Opens the Song Library for the signed-in caller: the session client (so
// 419's RLS applies to every read and write), the active-account gate, and
// who the caller is (SongLibraryViewer). No department is named here:
// managers are whoever 419's song_library_can_manage() says (the manage
// grant in service_owners).

import "server-only";

import type { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized } from "@/lib/song-library/http";
import { rpcFlag } from "@/lib/departments/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SongLibraryViewer } from "@/lib/song-library/access";
import type { Client } from "@/lib/song-library/types";

export type SongLibraryContext = {
  supabase: Client;
  /** Service role. Only for storage signing, display names and DMs, after the caller passed the gate. */
  admin: Client;
  viewer: SongLibraryViewer;
};

export async function loadViewer(supabase: Client, userId: string): Promise<{ ok: true; viewer: SongLibraryViewer; canRead: boolean } | { ok: false }> {
  const [read, manage, admin] = await Promise.all([
    rpcFlag(supabase, "song_library_can_read"),
    rpcFlag(supabase, "song_library_can_manage"),
    rpcFlag(supabase, "song_library_is_admin"),
  ]);
  if (!read.ok || !manage.ok || !admin.ok) return { ok: false };
  return {
    ok: true,
    canRead: read.value,
    viewer: { userId, isAdmin: admin.value, canManage: manage.value },
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
