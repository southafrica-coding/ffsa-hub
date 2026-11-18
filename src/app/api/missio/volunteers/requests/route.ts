import { createRequestSchema, firstIssue } from "@/lib/missio/availability/schema";
import { createAvailabilityRequest } from "@/lib/missio/availability/service";
import { fromResult, json, readJson, withPastor } from "@/lib/missio/availability/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withPastor("write", async (auth) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = createRequestSchema.safeParse(body.body);
    if (!parsed.success) return json({ error: firstIssue(parsed.error), code: "invalid_input" }, 400);
    const result = await createAvailabilityRequest(auth.supabase, auth.orgId, auth.user.id, parsed.data);
    if (!result.ok) return fromResult(result);
    return json(result.body, 201);
  });
}
