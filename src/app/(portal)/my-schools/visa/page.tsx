import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, NeedsYou, SectionBar, StatusPill } from "@/components/ffsa";
import { ChecklistPanel } from "@/components/visas/checklist-panel";
import { buildChecklist, studentToDo, type ChecklistDocument, type ChecklistType } from "@/lib/visas/checklist";
import { formatDay, statusTone } from "@/lib/visas/display";
import { VISA_STATUS_LABEL, type VisaStatus } from "@/lib/visas/status";
import { daysInclusive } from "@/lib/visas/stay";
import { getOpenVisaCaseForUser, getVisaCaseDocuments, getVisaCaseSchools, getVisaDocumentTypes } from "@/services/visas";

// The student's own visa case: what to send, what came back for a redo,
// and where the case is. RLS shows only their own case, schools and
// documents; approval requests, questions and the log stay with staff.

/** What the student sees for each status: one plain sentence. */
const NEXT_STEP: Record<VisaStatus, string> = {
  collecting_documents: "Upload each document below. Your school leader checks them as they come in.",
  awaiting_legal: "Everything is in. FFSA's legal officer is checking your application.",
  sent_back: "Your school leader is sorting out a few things. You'll hear if anything is needed from you.",
  approved: "Approved. Your school leader will tell you how and where to lodge your visa application.",
  lodged: "Your application is with the embassy. We'll update this when they decide.",
  granted: "Your visa has been granted. Bring it with you when you travel.",
  refused: "The embassy refused the application. FFSA's legal officer will be in touch.",
  exempt: "You don't need a visa for this stay.",
  arrived: "Welcome to South Africa.",
  closed: "This case is closed.",
  withdrawn: "This case was withdrawn.",
};

export default async function MyVisaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caseData } = await getOpenVisaCaseForUser(supabase, user.id);
  if (!caseData) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Training · Visa" title="Your visa" />
        <p className="px-5 py-8 text-[14px] md:px-8">
          You don&apos;t have a visa case. If you&apos;ve been accepted to a school and need a visa, your school leader will
          open one for you. <Link href="/my-schools" className="underline">Back to My training</Link>
        </p>
      </div>
    );
  }
  const c = caseData as { id: string; status: VisaStatus; stay_from: string | null; stay_to: string | null; lodge_by: string | null; visa_valid_to: string | null };

  const [{ data: schools }, { data: types }, { data: docs }] = await Promise.all([
    getVisaCaseSchools(supabase, c.id),
    getVisaDocumentTypes(supabase),
    getVisaCaseDocuments(supabase, c.id),
  ]);
  const stayDays = c.stay_from && c.stay_to ? daysInclusive(c.stay_from, c.stay_to) : null;
  const items = buildChecklist((types ?? []) as ChecklistType[], (docs ?? []) as ChecklistDocument[], stayDays);
  const collecting = c.status === "collecting_documents" || c.status === "sent_back";
  const toDo = collecting ? studentToDo(items) : [];
  const redo = toDo.filter((i) => i.state === "needs_redo").length;

  return (
    <div className="ffsa-screen">
      <Masthead context="Training · Visa" title="Your visa" />
      {toDo.length > 0 && (
        <NeedsYou>
          {redo > 0
            ? redo === 1
              ? "1 document needs to be sent again"
              : `${redo} documents need to be sent again`
            : toDo.length === 1
              ? "1 document still needs to be uploaded"
              : `${toDo.length} documents still need to be uploaded`}
        </NeedsYou>
      )}

      <div className="flex flex-col gap-6 px-5 py-6 md:px-8 md:py-7">
        <div className="border border-ink">
          <SectionBar title="Where it is" />
          <div className="flex flex-col gap-2 px-5 py-4 md:px-6">
            <div>
              <StatusPill tone={statusTone(c.status)}>{VISA_STATUS_LABEL[c.status]}</StatusPill>
            </div>
            <p className="text-[14px]">{NEXT_STEP[c.status]}</p>
            {c.stay_from && (
              <p className="mono-label">
                Your stay: {formatDay(c.stay_from)} – {formatDay(c.stay_to)}
                {stayDays != null ? ` · ${stayDays} days` : ""}
              </p>
            )}
            {c.visa_valid_to && <p className="mono-label">Visa valid to {formatDay(c.visa_valid_to)}</p>}
            {(schools ?? []).length > 0 && (
              <p className="mono-label">
                {(schools as Array<{ programs: { name: string } | null }>).map((s) => s.programs?.name ?? "School").join(" + ")}
              </p>
            )}
          </div>
        </div>

        <ChecklistPanel caseId={c.id} items={items} canChange={collecting} canReview={false} audience="student" />

        <p className="text-[13px] text-[#55524A]">
          Your documents are kept private. Only you, your school leaders and FFSA&apos;s legal officer can open them.
        </p>
      </div>
    </div>
  );
}
