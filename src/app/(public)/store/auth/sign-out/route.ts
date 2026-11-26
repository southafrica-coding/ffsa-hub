import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /store/auth/sign-out — end a buyer's session and go back to the Store.
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/store", request.url), 303);
}
