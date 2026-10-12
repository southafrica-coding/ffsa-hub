import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getSendingIdentity,
  updateSendingIdentity,
  forwardListError,
  type SendingIdentityPatch,
} from "@/services/sending-identities";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const existing = await getSendingIdentity(supabase, id);
  if (!existing.data) {
    return NextResponse.json({ error: "Identity not found" }, { status: 404 });
  }

  let body: SendingIdentityPatch;
  try {
    body = (await request.json()) as SendingIdentityPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate touched fields only.
  if (body.display_name !== undefined && !body.display_name.trim()) {
    return NextResponse.json(
      { error: "Display name cannot be empty" },
      { status: 400 }
    );
  }
  if (body.from_email !== undefined && !EMAIL_RE.test(body.from_email)) {
    return NextResponse.json(
      { error: "Provide a valid from email address" },
      { status: 400 }
    );
  }
  if (body.from_name !== undefined && !body.from_name.trim()) {
    return NextResponse.json(
      { error: "From name cannot be empty" },
      { status: 400 }
    );
  }
  if (
    body.reply_to !== undefined &&
    body.reply_to !== null &&
    body.reply_to !== "" &&
    !EMAIL_RE.test(body.reply_to)
  ) {
    return NextResponse.json(
      { error: "Reply-to must be a valid email or blank" },
      { status: 400 }
    );
  }

  if (body.forward_to !== undefined) {
    if (!Array.isArray(body.forward_to)) {
      return NextResponse.json(
        { error: "Forward list must be a list of emails" },
        { status: 400 }
      );
    }
    const fwdErr = forwardListError(body.forward_to);
    if (fwdErr) return NextResponse.json({ error: fwdErr }, { status: 400 });
  }

  // Don't let the last active identity be deactivated — that would lock out
  // future sends entirely.
  if (body.is_active === false) {
    const { data: activeRows } = await supabase
      .from("sending_identities")
      .select("id")
      .eq("is_active", true);
    const others = (activeRows ?? []).filter(
      (r: { id: string }) => r.id !== id
    );
    if (others.length === 0) {
      return NextResponse.json(
        {
          error:
            "Can't deactivate the last active identity — keep at least one active so campaigns can still be sent.",
        },
        { status: 400 }
      );
    }
  }

  const { data, error } = await updateSendingIdentity(supabase, id, body);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ identity: data });
}
