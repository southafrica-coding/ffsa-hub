import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createSendingIdentity,
  type SendingIdentityInsert,
} from "@/services/sending-identities";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: Partial<SendingIdentityInsert>;
  try {
    body = (await request.json()) as Partial<SendingIdentityInsert>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate
  if (!body.display_name?.trim()) {
    return NextResponse.json(
      { error: "Display name is required" },
      { status: 400 }
    );
  }
  if (!body.from_email?.trim() || !EMAIL_RE.test(body.from_email)) {
    return NextResponse.json(
      { error: "Provide a valid from email address" },
      { status: 400 }
    );
  }
  if (!body.from_name?.trim()) {
    return NextResponse.json(
      { error: "From name is required" },
      { status: 400 }
    );
  }
  if (body.reply_to && !EMAIL_RE.test(body.reply_to)) {
    return NextResponse.json(
      { error: "Reply-to must be a valid email or blank" },
      { status: 400 }
    );
  }
  // Resend is the only live transport; "mailtrap" survives only on old rows.
  if (body.provider && body.provider !== "resend") {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const { data, error } = await createSendingIdentity(supabase, {
    display_name: body.display_name,
    from_email: body.from_email,
    from_name: body.from_name,
    reply_to: body.reply_to ?? null,
    slug: body.slug,
    provider: "resend",
    is_active: body.is_active ?? true,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ identity: data });
}
