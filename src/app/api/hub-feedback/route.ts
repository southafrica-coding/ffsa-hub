import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { createHubFeedback } from "@/services/hub-feedback";
import {
  DETAILS_MAX,
  TITLE_MAX,
  isFeedbackKind,
  isFeedbackSeverity,
} from "@/lib/hub-feedback/constants";

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// POST /api/hub-feedback — anyone signed in sends a problem / idea / vision.
// Body: { kind, title, details?, severity?, page_path?, module_id?,
//         module_label?, user_agent?, viewport? }
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { kind } = body;
  const title = clip(body.title, TITLE_MAX);
  if (!isFeedbackKind(kind)) return NextResponse.json({ error: "Pick problem, idea or vision" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Give it a short title" }, { status: 400 });
  // Severity only means something for a problem.
  const severity = kind === "problem" && isFeedbackSeverity(body.severity) ? body.severity : null;

  const { data, error } = await createHubFeedback(supabase, {
    kind,
    title,
    details: clip(body.details, DETAILS_MAX),
    severity,
    page_path: clip(body.page_path, 500),
    module_id: clip(body.module_id, 100),
    module_label: clip(body.module_label, 100),
    user_agent: clip(body.user_agent, 500),
    viewport: clip(body.viewport, 40),
    submitted_by: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, feedback: { id: data.id, ref: data.ref } });
}
