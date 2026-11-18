import { contactIdSchema, firstIssue } from "@/lib/missio/availability/schema";
import { resetPersonalLink } from "@/lib/missio/availability/service";
import { appOrigin, fromResult, json, readJson, withPastor } from "@/lib/missio/availability/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return json({ error: "That request is not in Missio.", code: "invalid_input" }, 400);
  }
  return withPastor("link", async (auth) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = contactIdSchema.safeParse(body.body);
    if (!parsed.success) return json({ error: firstIssue(parsed.error), code: "invalid_input" }, 400);
    const result = await resetPersonalLink(auth.supabase, auth.orgId, id, parsed.data.contactId, appOrigin(request));
    return fromResult(result);
  });
}
