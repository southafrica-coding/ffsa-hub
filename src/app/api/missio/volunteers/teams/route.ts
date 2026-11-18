import { firstIssue, teamNameSchema } from "@/lib/missio/availability/schema";
import { createTeam } from "@/lib/missio/availability/service";
import { fromResult, json, readJson, withPastor } from "@/lib/missio/availability/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withPastor("write", async (auth) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = teamNameSchema.safeParse(body.body);
    if (!parsed.success) return json({ error: firstIssue(parsed.error), code: "invalid_input" }, 400);
    const result = await createTeam(auth.supabase, auth.orgId, parsed.data.name);
    if (!result.ok) return fromResult(result);
    return json(result.body, 201);
  });
}
