// Help requests, "I can help" sign-ups, helper categories, subscriptions
// and writer profiles.
//
//   POST   /api/song-library/songs/:id/help-requests       { categories, body } (the song's writers, managers)
//   GET    /api/song-library/help-requests                 ?status=open|filled|closed|all (default open) ?category=
//   PATCH  /api/song-library/help-requests/:rid            { status?, helper_user_id?, body?, categories? } (requester, managers)
//   DELETE /api/song-library/help-requests/:rid            (requester, managers)
//   POST   /api/song-library/help-requests/:rid/signup     { note? } I can help (anyone, open requests)
//   DELETE /api/song-library/help-requests/:rid/signup     take my sign-up back
//   GET    /api/song-library/helpers                       everyone's helper categories
//   PUT    /api/song-library/helpers/me                    { categories: [category | { category, note }] } replaces mine
//   GET    /api/song-library/subscriptions                 mine
//   POST   /api/song-library/subscriptions                 { target_type: all_uploads | writer, target_user_id? }
//   DELETE /api/song-library/subscriptions/:sid            mine
//   GET    /api/song-library/writers/:userId               songs they write on, what they help with, subscriber count

import "server-only";

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/departments/validate";
import { canAskForHelp, canManageHelpRequest } from "@/lib/song-library/access";
import { badRequest, coded, dbError, forbidden, notFound } from "@/lib/song-library/http";
import { parseHelpCreate, parseHelpPatch, parseHelperCategories, parseSignup, parseSubscription } from "@/lib/song-library/validate";
import { SL_CODES, SL_COLUMNS, SL_TABLES, SONG_HELP_CATEGORIES, SONG_HELP_STATUSES, type Row } from "@/lib/song-library/types";
import { body, isLoaded, isOpen, namesFor, openSong, openSongLibrary } from "./shared";
import type { SongLibraryContext } from "./context";

// ── Help requests ──────────────────────────────────────────

export async function createHelpRequest(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canAskForHelp(loaded.ctx.viewer, loaded.role)) return forbidden("Only the song's writers or a Song Library manager can ask for help on it", SL_CODES.notWriter);
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseHelpCreate(b.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const ins = await loaded.ctx.supabase
    .from(SL_TABLES.helpRequests)
    .insert({ song_id: songId, asked_by: loaded.ctx.viewer.userId, ...parsed.value })
    .select(SL_COLUMNS.helpRequests)
    .single();
  if (ins.error) return dbError(ins.error);
  return NextResponse.json({ help_request: ins.data }, { status: 201 });
}

export async function listHelpRequests(request: Request) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const p = new URL(request.url).searchParams;
  const status = p.get("status") ?? "open";
  const category = p.get("category");
  if (status !== "all" && !(SONG_HELP_STATUSES as readonly string[]).includes(status)) return badRequest("Unknown status");
  if (category && !(SONG_HELP_CATEGORIES as readonly string[]).includes(category)) return badRequest("Unknown category");
  let q = ctx.supabase.from(SL_TABLES.helpRequests).select(SL_COLUMNS.helpRequests);
  if (status !== "all") q = q.eq("status", status);
  const r = await q.order("created_at", { ascending: false }).limit(200);
  if (r.error) return dbError(r.error);
  let rows = (r.data ?? []) as Row[];
  if (category) rows = rows.filter((h) => (h.categories as string[]).includes(category));
  if (!rows.length) return NextResponse.json({ help_requests: [] });
  const [songs, signups] = await Promise.all([
    ctx.supabase.from(SL_TABLES.songs).select("id, title, stage").in("id", [...new Set(rows.map((h) => h.song_id))]),
    ctx.supabase.from(SL_TABLES.helpSignups).select(SL_COLUMNS.helpSignups).in("request_id", rows.map((h) => h.id)),
  ]);
  if (songs.error) return dbError(songs.error);
  if (signups.error) return dbError(signups.error);
  const songOf = new Map(((songs.data ?? []) as Row[]).map((s) => [s.id as string, s]));
  const signupRows = (signups.data ?? []) as Row[];
  const names = await namesFor(ctx.admin, [...rows.flatMap((h) => [h.asked_by as string, h.helper_user_id as string]), ...signupRows.map((s) => s.user_id as string)]);
  const name = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? null) : null);
  return NextResponse.json({
    help_requests: rows.map((h) => {
      const mine = signupRows.filter((s) => s.request_id === h.id);
      return {
        ...h,
        song: songOf.get(h.song_id as string) ?? null,
        asked_by_name: name(h.asked_by),
        helper_name: name(h.helper_user_id),
        signups: mine.map((s) => ({ ...s, name: name(s.user_id) })),
        i_signed_up: mine.some((s) => s.user_id === ctx.viewer.userId),
      };
    }),
  });
}

async function openHelpRequest(requestId: string): Promise<{ response: NextResponse } | { ctx: SongLibraryContext; row: Row }> {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx;
  if (!isUuid(requestId)) return { response: notFound("Help request not found") };
  const r = await ctx.supabase.from(SL_TABLES.helpRequests).select(SL_COLUMNS.helpRequests).eq("id", requestId).maybeSingle();
  if (r.error) return { response: dbError(r.error) };
  if (!r.data) return { response: notFound("Help request not found") };
  return { ctx, row: r.data as Row };
}

export async function patchHelpRequest(request: Request, requestId: string) {
  const opened = await openHelpRequest(requestId);
  if ("response" in opened) return opened.response;
  const { ctx, row } = opened;
  if (!canManageHelpRequest(ctx.viewer, row.asked_by as string | null)) return forbidden("Only whoever asked, or a Song Library manager, can change this request", SL_CODES.notWriter);
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseHelpPatch(b.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const up = await ctx.supabase.from(SL_TABLES.helpRequests).update(parsed.value).eq("id", requestId).select(SL_COLUMNS.helpRequests);
  if (up.error) return dbError(up.error);
  const next = ((up.data ?? []) as Row[])[0];
  if (!next) return forbidden("Only whoever asked, or a Song Library manager, can change this request", SL_CODES.notWriter);
  return NextResponse.json({ help_request: next });
}

export async function deleteHelpRequest(requestId: string) {
  const opened = await openHelpRequest(requestId);
  if ("response" in opened) return opened.response;
  const { ctx, row } = opened;
  if (!canManageHelpRequest(ctx.viewer, row.asked_by as string | null)) return forbidden("Only whoever asked, or a Song Library manager, can remove this request", SL_CODES.notWriter);
  const del = await ctx.supabase.from(SL_TABLES.helpRequests).delete().eq("id", requestId).select("id");
  if (del.error) return dbError(del.error);
  return NextResponse.json({ deleted: true });
}

export async function signUpToHelp(request: Request, requestId: string) {
  const opened = await openHelpRequest(requestId);
  if ("response" in opened) return opened.response;
  const { ctx, row } = opened;
  if (row.status !== "open") return coded(409, "This help request is no longer open", SL_CODES.helpClosed);
  let note: string | null = null;
  const text = await request.text();
  if (text.trim()) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return badRequest("Send a JSON body");
    }
    const parsed = parseSignup(raw);
    if (!parsed.ok) return badRequest(parsed.error);
    note = parsed.value.note;
  }
  const ins = await ctx.supabase.from(SL_TABLES.helpSignups).insert({ request_id: requestId, user_id: ctx.viewer.userId, note }).select(SL_COLUMNS.helpSignups);
  if (ins.error?.code === "23505") {
    const mine = await ctx.supabase.from(SL_TABLES.helpSignups).select(SL_COLUMNS.helpSignups).eq("request_id", requestId).eq("user_id", ctx.viewer.userId).maybeSingle();
    if (mine.error) return dbError(mine.error);
    return NextResponse.json({ signup: mine.data, already: true });
  }
  if (ins.error) return dbError(ins.error);
  return NextResponse.json({ signup: ((ins.data ?? []) as Row[])[0] ?? null }, { status: 201 });
}

export async function withdrawSignup(requestId: string) {
  const opened = await openHelpRequest(requestId);
  if ("response" in opened) return opened.response;
  const del = await opened.ctx.supabase.from(SL_TABLES.helpSignups).delete().eq("request_id", requestId).eq("user_id", opened.ctx.viewer.userId);
  if (del.error) return dbError(del.error);
  return NextResponse.json({ deleted: true });
}

// ── Helpers ────────────────────────────────────────────────

export async function listHelpers() {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const r = await ctx.supabase.from(SL_TABLES.helpers).select(SL_COLUMNS.helpers).order("created_at", { ascending: true });
  if (r.error) return dbError(r.error);
  const rows = (r.data ?? []) as Row[];
  const names = await namesFor(ctx.admin, rows.map((h) => h.user_id as string));
  const byUser = new Map<string, { user_id: string; name: string | null; categories: { category: string; note: string | null }[] }>();
  for (const h of rows) {
    const id = h.user_id as string;
    if (!byUser.has(id)) byUser.set(id, { user_id: id, name: names.get(id) ?? null, categories: [] });
    byUser.get(id)!.categories.push({ category: h.category as string, note: (h.note as string) ?? null });
  }
  return NextResponse.json({ helpers: [...byUser.values()], mine: byUser.get(ctx.viewer.userId)?.categories ?? [] });
}

export async function putMyHelperCategories(request: Request) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseHelperCategories(b.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const me = ctx.viewer.userId;
  const current = await ctx.supabase.from(SL_TABLES.helpers).select(SL_COLUMNS.helpers).eq("user_id", me);
  if (current.error) return dbError(current.error);
  const have = new Map(((current.data ?? []) as Row[]).map((h) => [h.category as string, h]));
  const want = new Map(parsed.value.map((c) => [c.category as string, c.note]));
  const gone = [...have.keys()].filter((c) => !want.has(c));
  if (gone.length) {
    const del = await ctx.supabase.from(SL_TABLES.helpers).delete().eq("user_id", me).in("category", gone);
    if (del.error) return dbError(del.error);
  }
  for (const [category, note] of want) {
    const row = have.get(category);
    const w = row
      ? row.note === note
        ? { error: null }
        : await ctx.supabase.from(SL_TABLES.helpers).update({ note }).eq("user_id", me).eq("category", category)
      : await ctx.supabase.from(SL_TABLES.helpers).insert({ user_id: me, category, note });
    if (w.error && w.error.code !== "23505") return dbError(w.error);
  }
  const after = await ctx.supabase.from(SL_TABLES.helpers).select(SL_COLUMNS.helpers).eq("user_id", me);
  if (after.error) return dbError(after.error);
  return NextResponse.json({ mine: ((after.data ?? []) as Row[]).map((h) => ({ category: h.category, note: h.note ?? null })) });
}

// ── Subscriptions ──────────────────────────────────────────

export async function listSubscriptions() {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const r = await ctx.supabase.from(SL_TABLES.subscriptions).select(SL_COLUMNS.subscriptions).eq("user_id", ctx.viewer.userId).order("created_at", { ascending: true });
  if (r.error) return dbError(r.error);
  const rows = (r.data ?? []) as Row[];
  const names = await namesFor(ctx.admin, rows.map((s) => s.target_user_id as string));
  return NextResponse.json({
    subscriptions: rows.map((s) => ({ ...s, target_name: s.target_user_id ? (names.get(s.target_user_id as string) ?? null) : null })),
    all_uploads: rows.some((s) => s.target_type === "all_uploads"),
  });
}

export async function subscribe(request: Request) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseSubscription(b.value, ctx.viewer.userId);
  if (!parsed.ok) return badRequest(parsed.error);
  if (parsed.value.target_user_id) {
    const u = await ctx.admin.from("users").select("id").eq("id", parsed.value.target_user_id).maybeSingle();
    if (u.error) return dbError(u.error);
    if (!u.data) return notFound("Writer not found");
  }
  const ins = await ctx.supabase
    .from(SL_TABLES.subscriptions)
    .insert({ user_id: ctx.viewer.userId, ...parsed.value })
    .select(SL_COLUMNS.subscriptions);
  if (ins.error?.code === "23505") {
    let q = ctx.supabase.from(SL_TABLES.subscriptions).select(SL_COLUMNS.subscriptions).eq("user_id", ctx.viewer.userId).eq("target_type", parsed.value.target_type);
    if (parsed.value.target_user_id) q = q.eq("target_user_id", parsed.value.target_user_id);
    const existing = await q.limit(1);
    if (existing.error) return dbError(existing.error);
    return NextResponse.json({ subscription: ((existing.data ?? []) as Row[])[0] ?? null, already: true });
  }
  if (ins.error) return dbError(ins.error);
  return NextResponse.json({ subscription: ((ins.data ?? []) as Row[])[0] ?? null }, { status: 201 });
}

export async function unsubscribe(subscriptionId: string) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  if (!isUuid(subscriptionId)) return notFound("Subscription not found");
  const del = await ctx.supabase.from(SL_TABLES.subscriptions).delete().eq("id", subscriptionId).eq("user_id", ctx.viewer.userId).select("id");
  if (del.error) return dbError(del.error);
  if (!((del.data ?? []) as Row[]).length) return notFound("Subscription not found");
  return NextResponse.json({ deleted: true });
}

// ── Writer profile ─────────────────────────────────────────

export async function getWriter(userId: string) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  if (!isUuid(userId)) return notFound("Writer not found");
  const names = await namesFor(ctx.admin, [userId]);
  if (!names.has(userId)) return notFound("Writer not found");
  const [credits, helps, count, mine] = await Promise.all([
    ctx.supabase.from(SL_TABLES.writers).select("song_id, is_lead, role").eq("user_id", userId),
    ctx.supabase.from(SL_TABLES.helpers).select(SL_COLUMNS.helpers).eq("user_id", userId),
    ctx.supabase.rpc("song_library_writer_subscriber_count", { p_writer_id: userId }),
    ctx.supabase.from(SL_TABLES.subscriptions).select("id").eq("user_id", ctx.viewer.userId).eq("target_type", "writer").eq("target_user_id", userId).limit(1),
  ]);
  for (const r of [credits, helps, count, mine]) if (r.error) return dbError(r.error);
  const creditRows = (credits.data ?? []) as Row[];
  const songs = creditRows.length
    ? await ctx.supabase.from(SL_TABLES.songs).select("id, title, stage, placement, last_activity_at").in("id", creditRows.map((c) => c.song_id))
    : { data: [], error: null };
  if (songs.error) return dbError(songs.error);
  const songRows = (songs.data ?? []) as Row[];
  return NextResponse.json({
    writer: { user_id: userId, name: names.get(userId) },
    written: songRows.filter((s) => creditRows.some((c) => c.song_id === s.id && c.is_lead)),
    co_written: songRows.filter((s) => creditRows.some((c) => c.song_id === s.id && !c.is_lead)),
    helps_with: ((helps.data ?? []) as Row[]).map((h) => ({ category: h.category, note: h.note ?? null })),
    subscriber_count: typeof count.data === "number" ? count.data : 0,
    subscription_id: (((mine.data ?? []) as Row[])[0]?.id as string) ?? null,
  });
}
