import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized, serverError } from "@/lib/departments/http";
import { listMinistriesById } from "@/lib/departments/repository";
import { usableServiceKeys } from "@/lib/services/access";
import { toHubService } from "@/lib/services/present";
import { listServiceOwnerRows, listServices } from "@/lib/services/repository";
import { createClient } from "@/lib/supabase/server";

// GET /api/services — bare HubService[].

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();
  const [services, grants] = await Promise.all([listServices(supabase), listServiceOwnerRows(supabase)]);
  if (services.error || grants.error) return serverError(services.error ?? grants.error);
  const usable = await usableServiceKeys(
    supabase,
    services.data.map((service) => service.service_key)
  );
  if (!usable.ok) return notAuthorized();
  const visible = services.data.filter((service) => usable.keys.has(service.service_key));
  const ministries = await listMinistriesById(
    supabase,
    grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
  );
  if (ministries.error) return serverError(ministries.error);
  return NextResponse.json(
    visible
      .sort((a, b) => a.service_key.localeCompare(b.service_key))
      .map((service) =>
        toHubService(
          service,
          grants.data.filter((grant) => grant.service_key === service.service_key),
          ministries.data
        )
      )
  );
}
