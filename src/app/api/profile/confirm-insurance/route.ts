import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// One-click "my health insurance is still up to date". Stamps the
// confirmation timestamp server-side (never trust a client clock) after
// checking a real provider is on file, which resets the 6-monthly
// re-confirmation clock the gate reads from health_insurance_confirmed_at.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Can't confirm cover that isn't on file — send them back to the form.
  const { data: profile } = await supabase
    .from("users")
    .select("health_insurance_provider")
    .eq("id", user.id)
    .single();

  const provider = String(profile?.health_insurance_provider ?? "").trim();
  if (provider === "" || provider.toLowerCase() === "none") {
    return NextResponse.json(
      { error: "Add a valid health insurance provider before confirming." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("users")
    .update({ health_insurance_confirmed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
