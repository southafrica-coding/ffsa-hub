import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Both request flows (migration 170), which are the same shape from the UI's
 * point of view: someone asks, someone competent decides.
 *
 *   ?kind=seat  — asking for an open seat on a set. Leads decide.
 *   ?kind=eval  — asking to be evaluated for a seat. Evaluators decide.
 *
 * Who may read, ask or decide is enforced by RLS, so this route stays a thin
 * pass-through rather than a second copy of the rules.
 */

const TABLES = {
  seat: "prayer_room_seat_requests",
  eval: "prayer_room_evaluation_requests",
} as const;

type Kind = keyof typeof TABLES;

function tableFor(url: URL): { table: string; kind: Kind } | null {
  const kind = url.searchParams.get("kind") as Kind | null;
  if (!kind || !(kind in TABLES)) return null;
  return { table: TABLES[kind], kind };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const t = tableFor(url);
  if (!t) return NextResponse.json({ error: "kind must be 'seat' or 'eval'" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const NAME = "id, first_name, last_name, preferred_name";

  try {
    let q =
      t.kind === "seat"
        ? db
            .from(t.table)
            .select(
              `id, set_id, seat_type_id, user_id, state, message, created_at,
               user:user_id(${NAME}),
               set:set_id(id, set_date, start_time, end_time, title)`
            )
        : db
            .from(t.table)
            .select(
              `id, seat_type_id, user_id, state, note, scheduled_at, created_at,
               user:user_id(${NAME})`
            );

    const setId = url.searchParams.get("setId");
    if (setId && t.kind === "seat") q = q.eq("set_id", setId);

    const state = url.searchParams.get("state");
    if (state) q = q.in("state", state.split(","));

    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) return NextResponse.json([], { status: 200 });
    return NextResponse.json(data ?? []);
  } catch {
    // Table absent (migration 170 not applied) — an empty inbox, not an error.
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const t = tableFor(url);
  if (!t) return NextResponse.json({ error: "kind must be 'seat' or 'eval'" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body?.seat_type_id) {
    return NextResponse.json({ error: "seat_type_id is required" }, { status: 400 });
  }
  if (t.kind === "seat" && !body.set_id) {
    return NextResponse.json({ error: "set_id is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Always the caller's own request. Asking on someone else's behalf is a
  // staff action and goes through the admin surfaces, not this one.
  const row =
    t.kind === "seat"
      ? {
          set_id: body.set_id,
          seat_type_id: body.seat_type_id,
          user_id: user.id,
          message: body.message ?? null,
        }
      : {
          seat_type_id: body.seat_type_id,
          user_id: user.id,
          note: body.note ?? null,
        };

  const { error } = await db.from(t.table).insert(row);
  if (error) {
    // The partial unique indexes in 170 mean "you already have one open".
    const msg = (error as { code?: string; message?: string }).code === "23505"
      ? "You have already asked for this."
      : (error as { message?: string }).message ?? "Could not send the request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const t = tableFor(url);
  if (!t) return NextResponse.json({ error: "kind must be 'seat' or 'eval'" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body?.id || !body?.state) {
    return NextResponse.json({ error: "id and state are required" }, { status: 400 });
  }

  const ALLOWED: Record<Kind, string[]> = {
    seat: ["accepted", "declined", "withdrawn"],
    eval: ["booked", "done", "cancelled"],
  };
  if (!ALLOWED[t.kind].includes(body.state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const patch =
    t.kind === "seat"
      ? { state: body.state, decided_by: user.id, decided_at: new Date().toISOString() }
      : {
          state: body.state,
          evaluator_id: body.state === "booked" ? user.id : undefined,
          scheduled_at: body.scheduled_at ?? undefined,
        };

  const { error } = await db.from(t.table).update(patch).eq("id", body.id);
  if (error) {
    return NextResponse.json(
      { error: (error as { message?: string }).message ?? "Could not update the request" },
      { status: 400 }
    );
  }

  // Accepting does NOT fill the seat — filling runs through the roster so the
  // cross-set overlap guard (migration 108) still applies. The lead fills from
  // the set detail with the request in hand.
  return NextResponse.json({ ok: true });
}
