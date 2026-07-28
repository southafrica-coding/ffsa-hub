import { createAdminClient } from "@/lib/supabase/admin";
import { JoinForm } from "./join-form";
import { JoinInvalid } from "./join-invalid";

type Params = { code: string };

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<Params> }) {
  const { code } = await params;

  const adminSupabase = createAdminClient();

  // Resolve the code to its signup link type. Valid iff a row
  // exists for the code and that link is enabled.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminSupabase as any)
    .from("signup_links")
    .select("type, enabled")
    .eq("code", code)
    .maybeSingle();

  const valid = !!data && data.enabled === true;

  if (!valid) {
    return <JoinInvalid />;
  }

  return <JoinForm code={code} type={data.type} />;
}
