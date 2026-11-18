import { removeTeamPerson } from "@/lib/missio/availability/service";
import { fromResult, json, withPastor } from "@/lib/missio/availability/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(contactId).success) {
    return json({ error: "That person is not on this team.", code: "invalid_input" }, 400);
  }
  return withPastor("write", async (auth) =>
    fromResult(await removeTeamPerson(auth.supabase, auth.orgId, id, contactId, "members"))
  );
}
