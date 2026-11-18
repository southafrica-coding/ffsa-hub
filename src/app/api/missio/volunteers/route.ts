import { loadVolunteers } from "@/lib/missio/availability/service";
import { fromResult, withPastor } from "@/lib/missio/availability/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("requestId");
  return withPastor(null, async (auth) => {
    const result = await loadVolunteers(auth.supabase, auth.orgId, requestId);
    return fromResult(result);
  });
}
