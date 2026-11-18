import { prepareNudge } from "@/lib/missio/availability/service";
import { appOrigin, fromResult, json, withPastor } from "@/lib/missio/availability/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return json({ error: "That request is not in Missio.", code: "invalid_input" }, 400);
  }
  return withPastor("nudge", async (auth) => {
    const result = await prepareNudge(auth.supabase, auth.orgId, id, appOrigin(request));
    return fromResult(result);
  });
}
