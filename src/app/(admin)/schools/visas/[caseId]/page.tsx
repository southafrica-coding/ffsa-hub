import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Kpi, KpiStrip, Masthead, NeedsYou, SectionBar } from "@/components/ffsa";
import { ChecklistPanel } from "@/components/visas/checklist-panel";
import { canFollowUp, getVisaAccess, isLegalFor } from "@/lib/visas/access";
import { buildChecklist, toReview, type ChecklistDocument, type ChecklistType } from "@/lib/visas/checklist";
import { WAITING_LABEL, formatDay, personName } from "@/lib/visas/display";
import { VISA_STATUS_LABEL, type VisaStatus, type VisaWaitingOn } from "@/lib/visas/status";
import { daysInclusive } from "@/lib/visas/stay";
import {
  getProgramNames,
  getVisaApprovalRequests,
  getVisaCaseById,
  getVisaCaseDocuments,
  getVisaCaseEvents,
  getVisaCaseQuestions,
  getVisaCaseSchools,
  getVisaDocumentTypes,
  getVisaMissingDocuments,
  getVisaPeopleNames,
} from "@/services/visas";
import { ApprovalPanel, ProgressPanel, QuestionsPanel, type QuestionRow, type RequestRow } from "./case-actions";

// One visa case, for school leaders and legal. Reads go through RLS with
// the user's client; names come from the admin client for ids RLS already
// showed. Passport numbers are not read here at all.

const EVENT_LABEL: Record<string, string> = {
  document_uploaded: "Document uploaded",
  step_ticked: "Step ticked",
  document_approved: "Document approved",
  document_needs_redo: "Redo asked for",
  document_downloaded: "Document opened",
  approval_requested: "Approval requested",
  approved: "Approved by legal",
  sent_back: "Sent back by legal",
  question_asked: "Question for legal",
  question_answered: "Legal answered",
  lodged: "Lodged",
  granted: "Granted",
  refused: "Refused",
  arrived: "Arrived",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

type CaseRow = {
  id: string;
  user_id: string;
  status: VisaStatus;
  waiting_on: VisaWaitingOn;
  stay_from: string | null;
  stay_to: string | null;
  lodge_by: string | null;
  lodged_on: string | null;
  lodged_where: string | null;
  embassy_reference: string | null;
  decided_on: string | null;
  visa_valid_to: string | null;
  refusal_reason: string | null;
  arrived_on: string | null;
  entry_stamp_ok: boolean | null;
};

export default async function VisaCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getVisaAccess(supabase, user.id);
  if (!access.open) redirect("/schools");
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) notFound();

  const { data: caseData } = await getVisaCaseById(supabase, caseId);
  if (!caseData) notFound();
  const c = caseData as CaseRow;

  const [schoolsRes, typesRes, docsRes, missingRes, requestsRes, questionsRes, eventsRes] = await Promise.all([
    getVisaCaseSchools(supabase, caseId),
    getVisaDocumentTypes(supabase),
    getVisaCaseDocuments(supabase, caseId),
    getVisaMissingDocuments(supabase, caseId),
    getVisaApprovalRequests(supabase, caseId),
    getVisaCaseQuestions(supabase, caseId),
    getVisaCaseEvents(supabase, caseId),
  ]);
  const schools = (schoolsRes.data ?? []) as Array<{
    id: string;
    program_id: string;
    start_date: string | null;
    end_date: string | null;
    arrival_date: string | null;
    departure_date: string | null;
    billing_courses: { name: string } | null;
  }>;
  const programIds = schools.map((s) => s.program_id);
  // Nobody is staff on their own case (363 refuses it too): a leader or
  // legal looking at their own visa sees it, but can't act on it.
  const ownCase = c.user_id === user.id;
  const isLegal = !ownCase && isLegalFor(access, programIds);
  const canFollow = !ownCase && canFollowUp(access, programIds);

  const requests = (requestsRes.data ?? []) as Array<Omit<RequestRow, "requested_by_name" | "decided_by_name"> & {
    requested_by: string | null;
    decided_by: string | null;
  }>;
  const questions = (questionsRes.data ?? []) as Array<Omit<QuestionRow, "asked_by_name"> & { asked_by: string | null }>;
  const events = (eventsRes.data ?? []) as Array<{ id: string; kind: string; actor_id: string | null; created_at: string }>;

  const peopleIds = [
    c.user_id,
    ...requests.flatMap((r) => [r.requested_by, r.decided_by]),
    ...questions.map((q) => q.asked_by),
    ...events.map((e) => e.actor_id),
  ].filter((id): id is string => !!id);
  const [{ data: people }, { data: programs }] = await Promise.all([
    getVisaPeopleNames(createAdminClient(), peopleIds),
    getProgramNames(supabase, programIds),
  ]);
  const nameOf = new Map((people ?? []).map((p: { id: string }) => [p.id, p]));
  const name = (id: string | null) => (id ? personName(nameOf.get(id) as never) : "Someone");
  const programName = new Map<string, string>(((programs ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));

  const stayDays = c.stay_from && c.stay_to ? daysInclusive(c.stay_from, c.stay_to) : null;
  const items = buildChecklist(
    (typesRes.data ?? []) as ChecklistType[],
    (docsRes.data ?? []) as ChecklistDocument[],
    stayDays
  );
  const missing = ((missingRes.data ?? []) as string[]).filter(Boolean);
  const collecting = c.status === "collecting_documents" || c.status === "sent_back";
  const reviewCount = toReview(items).length;
  const student = name(c.user_id);
  // Two people on every approval: whoever sent the open request can't decide it.
  const openRequest = requests.find((r) => r.decision === null);
  const canDecide = isLegal && !!openRequest && openRequest.requested_by !== user.id;

  // One band: what this viewer has to do on this case, if anything.
  let band: string | null = null;
  if (c.status === "awaiting_legal" && canDecide) band = "This case is waiting for your approval";
  else if (collecting && canFollow && reviewCount > 0)
    band = reviewCount === 1 ? "1 document is waiting for your review" : `${reviewCount} documents are waiting for your review`;
  else if (collecting && canFollow && missing.length === 0) band = "Every document is in. Request approval from legal";
  else if (c.status === "arrived" && c.entry_stamp_ok === false && isLegal) band = "The entry stamp doesn't match the visa";

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Visas · ${programIds.map((p) => programName.get(p) ?? "School").join(" + ")}`}
        title={student}
        actions={
          <Link href="/schools/visas" className="mono-label underline-offset-4 hover:underline">
            All cases
          </Link>
        }
      />
      {band && <NeedsYou>{band}</NeedsYou>}

      <KpiStrip>
        <Kpi label="Stay" value={stayDays != null ? `${stayDays}` : "—"} foot={stayDays != null ? "days in South Africa" : "dates not set"} lead tick={!band} />
        <Kpi label="Status" value={VISA_STATUS_LABEL[c.status]} size={26} />
        <Kpi label="Waiting on" value={WAITING_LABEL[c.waiting_on]} size={26} />
        <Kpi label="Lodge by" value={c.lodge_by ? formatDay(c.lodge_by) : "—"} size={26} />
      </KpiStrip>

      <div className="grid gap-6 px-5 py-6 md:px-8 md:py-7 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <ChecklistPanel caseId={caseId} items={items} canChange={collecting && canFollow} canReview={canFollow} audience="staff" />
          {(canFollow || isLegal) && (
            <ApprovalPanel
              caseId={caseId}
              status={c.status}
              missing={missing}
              isLegal={isLegal}
              canFollow={canFollow}
              currentUserId={user.id}
              requests={requests.map((r) => ({
                ...r,
                requested_by_name: name(r.requested_by),
                decided_by_name: r.decided_by ? name(r.decided_by) : null,
              }))}
            />
          )}
          {canFollow && <ProgressPanel caseId={caseId} status={c.status} isLegal={isLegal} />}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <div className="border border-ink">
            <SectionBar title="Stay" meta={stayDays != null && stayDays > 90 ? "Over 90 days" : undefined} />
            <ul>
              {schools.map((s) => (
                <li key={s.id} className="border-b border-rule px-5 py-3 last:border-b-0">
                  <div className="text-[14px] font-semibold">
                    {programName.get(s.program_id) ?? "School"}
                    {s.billing_courses?.name ? ` · ${s.billing_courses.name}` : ""}
                  </div>
                  <div className="mono-label mt-1">
                    Arrive {formatDay(s.arrival_date ?? s.start_date)} · Leave {formatDay(s.departure_date ?? s.end_date)}
                  </div>
                </li>
              ))}
              {schools.length === 0 && <li className="px-5 py-3 text-[14px] text-[#55524A]">No schools on this case yet.</li>}
            </ul>
            {(c.lodged_on || c.visa_valid_to || c.arrived_on || c.refusal_reason) && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-rule px-5 py-3 text-[13px]">
                {c.lodged_on && (
                  <>
                    <dt className="mono-label">Lodged</dt>
                    <dd>
                      {formatDay(c.lodged_on)}
                      {c.lodged_where ? `, ${c.lodged_where}` : ""}
                    </dd>
                  </>
                )}
                {c.embassy_reference && (
                  <>
                    <dt className="mono-label">Reference</dt>
                    <dd>{c.embassy_reference}</dd>
                  </>
                )}
                {c.visa_valid_to && (
                  <>
                    <dt className="mono-label">Visa valid to</dt>
                    <dd>{formatDay(c.visa_valid_to)}</dd>
                  </>
                )}
                {c.refusal_reason && (
                  <>
                    <dt className="mono-label">Refused</dt>
                    <dd>{c.refusal_reason}</dd>
                  </>
                )}
                {c.arrived_on && (
                  <>
                    <dt className="mono-label">Arrived</dt>
                    <dd>
                      {formatDay(c.arrived_on)} · stamp {c.entry_stamp_ok ? "OK" : "wrong"}
                    </dd>
                  </>
                )}
              </dl>
            )}
          </div>

          {(canFollow || isLegal) && (
            <QuestionsPanel
              caseId={caseId}
              isLegal={isLegal}
              canFollow={canFollow}
              questions={questions.map((q) => ({ ...q, asked_by_name: name(q.asked_by) }))}
            />
          )}

          <div className="border border-ink">
            <SectionBar title="History" />
            <ul className="max-h-[420px] overflow-y-auto">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 border-b border-rule px-5 py-2 text-[13px] last:border-b-0">
                  <span>
                    {EVENT_LABEL[e.kind] ?? e.kind}
                    <span className="text-[#7C786C]"> · {name(e.actor_id)}</span>
                  </span>
                  <span className="mono-label shrink-0">{formatDay(e.created_at)}</span>
                </li>
              ))}
              {events.length === 0 && <li className="px-5 py-3 text-[14px] text-[#55524A]">Nothing yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
