import { firstIssue, teamNameSchema } from "@/lib/missio/availability/schema";
import { deleteTeam, renameTeam } from "@/lib/missio/availability/service";
import { fromResult, json, readJson, withPastor } from "@/lib/missio/availability/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

function badId() {
  return json({ error: "That team is not in Missio.", code: "invalid_input" }, 400);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return badId();
  return withPastor("write", async (auth) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = teamNameSchema.safeParse(body.body);
    if (!parsed.success) return json({ error: firstIssue(parsed.error), code: "invalid_input" }, 400);
    return fromResult(await renameTeam(auth.supabase, auth.orgId, id, parsed.data.name));
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return badId();
  return withPastor("write", async (auth) => fromResult(await deleteTeam(auth.supabase, auth.orgId, id)));
}
