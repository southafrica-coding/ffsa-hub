import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized, notFound, serverError } from "@/lib/departments/http";
import { listMinistriesById } from "@/lib/departments/repository";
import { canUseService } from "@/lib/services/access";
import { toHubService } from "@/lib/services/present";
import { listServiceOwnerRows, listServices } from "@/lib/services/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();
  if (!/^[a-z0-9_]+$/.test(key)) return notFound("Service not found");

  // Same answer for a missing key and a key this caller cannot use.
  // The check is user_can_use_service, before any service-role read.
  if (!(await canUseService(supabase, user.id, key))) return notAuthorized();

  const admin = createAdminClient();
  const [services, grants] = await Promise.all([listServices(admin), listServiceOwnerRows(admin, key)]);
  if (services.error || grants.error) return serverError(services.error ?? grants.error);
  const service = services.data.find((row) => row.service_key === key);
  if (!service && grants.data.length === 0) return notFound("Service not found");
  const ministries = await listMinistriesById(
    admin,
    grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
  );
  if (ministries.error) return serverError(ministries.error);
  const card = service ?? { service_key: key, label: key, admin_href: grants.data[0]?.admin_href ?? "" };
  return NextResponse.json(toHubService(card, grants.data, ministries.data));
}
