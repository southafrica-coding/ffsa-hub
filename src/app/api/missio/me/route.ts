import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getMyOrgs } from "@/lib/missio/access";
import type { MissioMe } from "@/lib/missio/types";
import { createClient } from "@/lib/supabase/server";

// Who am I inside Missio? Any signed-in user may call. No org role comes back
// as an empty list — an FFSA admin is not a Missio user unless org_staff_roles
// says so. Only the caller's own rows, through their own client.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated", code: "unauthenticated" }, { status: 401 });
  }

  const mine = await getMyOrgs(supabase, user.id);
  if ("error" in mine) {
    console.error("[missio] membership lookup failed", mine.error.message);
    return NextResponse.json({ error: "Something went wrong.", code: "server_error" }, { status: 500 });
  }

  const body: MissioMe = {
    orgs: mine.orgs,
    rolesByOrg: mine.rolesByOrg,
    currentOrg: mine.rolesByOrg.missio?.length ? "missio" : null,
  };
  return NextResponse.json(body);
}
