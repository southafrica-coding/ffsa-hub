import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getContactLists, createContactList } from "@/services/contact-lists";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await getContactLists(supabase);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ lists: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "A list name is required" }, { status: 400 });
  }

  const { data, error } = await createContactList(supabase, {
    name,
    description: body.description?.trim() || null,
    createdBy: user.id,
  });

  if (error) {
    // RLS denial surfaces here for users without contacts-write access.
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ list: data });
}
