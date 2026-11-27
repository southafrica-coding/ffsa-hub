import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, NeedsYou, SectionBar, StatusPill } from "@/components/ffsa";
import { ChecklistPanel } from "@/components/visas/checklist-panel";
import { StudentLettersPanel, type LetterRow } from "@/components/visas/letters-panel";
import { EmbassyPanel, StudentFfsaDocuments, type EmbassyOption } from "@/components/visas/embassy-panel";
import type { Embassy } from "@/lib/visas/embassies";
import { buildChecklist, studentToDo, type ChecklistDocument, type ChecklistType } from "@/lib/visas/checklist";
import { formatDay, statusTone } from "@/lib/visas/display";
import { VISA_STATUS_LABEL, type VisaStatus } from "@/lib/visas/status";
import { daysInclusive } from "@/lib/visas/stay";
import {
  getOpenVisaCaseForUser,
  getVisaCaseDocuments,
  getVisaCaseSchools,
  getVisaCaseStandingDocuments,
  getVisaDocumentTypes,
  getVisaEmbassies,
  getVisaEmbassyById,
  getVisaLetters,
} from "@/services/visas";

// The student chooses the embassy until legal has approved (500).
const CHOOSE_EMBASSY: VisaStatus[] = ["collecting_documents", "sent_back", "awaiting_legal"];

// The student's own visa case: what to send, what came back for a redo,
// and where the case is. RLS shows only their own case, schools and
// documents; approval requests, questions and the log stay with staff.

/** What the student sees for each status: one plain sentence. */
const NEXT_STEP: Record<VisaStatus, string> = {
  collecting_documents: "Upload each document below. Your school leader checks them as they come in.",
  awaiting_legal: "Everything is in. FFSA's legal officer is checking your application.",
  sent_back: "Your school leader is sorting out a few things. You'll hear if anything is needed from you.",
  approved: "Approved. Check FFSA's letters below; once they're signed, your school leader will tell you how and where to lodge your visa application.",
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
  const c = caseData as { id: string; status: VisaStatus; stay_from: string | null; stay_to: string | null; lodge_by: string | null; visa_valid_to: string | null; embassy_id: string | null };

  const canChooseEmbassy = CHOOSE_EMBASSY.includes(c.status);
  const [{ data: schools }, { data: types }, { data: docs }, { data: letterData }, { data: embassyData }, { data: optionData }, { data: ffsaDocs }] =
    await Promise.all([
      getVisaCaseSchools(supabase, c.id),
      getVisaDocumentTypes(supabase),
      getVisaCaseDocuments(supabase, c.id),
      getVisaLetters(supabase, c.id),
      c.embassy_id ? getVisaEmbassyById(supabase, c.embassy_id) : Promise.resolve({ data: null }),
      canChooseEmbassy ? getVisaEmbassies(supabase, { activeOnly: true }) : Promise.resolve({ data: [] }),
      c.status === "approved" || c.status === "lodged" ? getVisaCaseStandingDocuments(supabase, c.id) : Promise.resolve({ data: [] }),
    ]);
  const embassy = (embassyData ?? null) as Embassy | null;
  const schoolName = new Map(
    ((schools ?? []) as Array<{ program_id: string; programs: { name: string } | null }>).map((s) => [s.program_id, s.programs?.name ?? "School"])
  );
  const letters: LetterRow[] = ((letterData ?? []) as Array<Omit<LetterRow, "school"> & { program_id: string | null }>).map((l) => ({
    ...l,
    school: l.program_id ? (schoolName.get(l.program_id) ?? "School") : null,
  }));
  const lettersToCheck = letters.filter((l) => l.status === "with_student").length;
  const stayDays = c.stay_from && c.stay_to ? daysInclusive(c.stay_from, c.stay_to) : null;
  const items = buildChecklist((types ?? []) as ChecklistType[], (docs ?? []) as ChecklistDocument[], stayDays);
  const collecting = c.status === "collecting_documents" || c.status === "sent_back";
  const toDo = collecting ? studentToDo(items) : [];
  const redo = toDo.filter((i) => i.state === "needs_redo" || i.state === "flagged").length;

  return (
    <div className="ffsa-screen">
      <Masthead context="Training · Visa" title="Your visa" />
      {toDo.length === 0 && lettersToCheck > 0 && (
        <NeedsYou>
          {lettersToCheck === 1 ? "1 letter is waiting for you to check" : `${lettersToCheck} letters are waiting for you to check`}
        </NeedsYou>
      )}
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

        {(embassy || canChooseEmbassy) && (
          <EmbassyPanel
            caseId={c.id}
            embassy={embassy}
            options={(optionData ?? []) as EmbassyOption[]}
            canChange={canChooseEmbassy}
            audience="student"
          />
        )}

        <StudentLettersPanel letters={letters} />

        <StudentFfsaDocuments
          caseId={c.id}
          documents={(ffsaDocs ?? []) as Array<{ id: string; label: string; description: string | null }>}
        />

        <ChecklistPanel caseId={c.id} items={items} canChange={collecting} audience="student" />

        <p className="text-[13px] text-[#55524A]">
          Your documents are kept private. Only you, your school leaders (while your school is on) and FFSA&apos;s legal officer
          can open them. Your police clearance and medical report only you and the legal officer can open.
        </p>
      </div>
    </div>
  );
}
