import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBuyer } from "@/lib/store/access";
import { removeDevice } from "@/services/store";
import { bad, NO_STORE } from "../../_shared";

// DELETE /api/store/devices/[id] — remove one of your reading devices.
// Runs as the buyer: RLS ("store devices: own remove") and the user_id
// filter both keep it to their own rows.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) return bad("Sign in first", 401);
  const { data, error } = await removeDevice(supabase, buyer.userId, id);
  if (error) return bad("We couldn't remove that device. Try again.", 500);
  if (!data) return bad("That device isn't on your list", 404);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
