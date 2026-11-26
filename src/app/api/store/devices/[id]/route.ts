import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBuyer } from "@/lib/store/access";
import { storeAdminClient } from "@/lib/store/db";
import { removeDevice } from "@/services/store";
import { bad, NO_STORE } from "../../_shared";

// DELETE /api/store/devices/[id] — remove one of your reading devices.
// The buyer session (confirmed email) is checked here; the removal itself
// runs through store_remove_device with the service role, scoped to the
// buyer's own auth uid. Buyers have no UPDATE on store_devices at all, so
// nothing can clear removed_at and lift the three-device cap.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("That device isn't on your list", 404);
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) return bad("Sign in first", 401);
  const { data, error } = await removeDevice(storeAdminClient(), buyer.userId, id);
  if (error) return bad("We couldn't remove that device. Try again.", 500);
  if (!data) return bad("That device isn't on your list", 404);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
