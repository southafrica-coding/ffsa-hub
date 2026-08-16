import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Reference data the wall needs: which seats are LEAD seats (so a set can be
 * told live from "needs a lead"), and the curated anchor bands.
 *
 * Both degrade to empty rather than failing. The seat vocabulary arrives with
 * migration 167 and the band columns with 171, and this must render on a
 * database where neither has been applied — the wall falls back to the two
 * legacy lead roles when the seat list comes back empty.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ seatTypes: [], bands: [] }, { status: 401 });

  // Neither table is in the generated Database types yet (same loose-client
  // convention as services/prayer-room.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  async function safe<T>(run: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T[]> {
    try {
      const { data, error } = await run();
      if (error) return [];
      return (data ?? []) as T[];
    } catch {
      return [];
    }
  }

  const [seatTypes, bands] = await Promise.all([
    safe(() =>
      db
        .from("prayer_room_seat_types")
        .select("id, label, is_lead")
        .eq("is_active", true)
        .order("sort_order")
    ),
    safe(() =>
      db
        .from("prayer_room_template_blocks")
        .select("id, band_name, day_of_week, start_time, end_time, weekly_focus")
        .eq("is_curated", true)
    ),
  ]);

  return NextResponse.json({ seatTypes, bands });
}
