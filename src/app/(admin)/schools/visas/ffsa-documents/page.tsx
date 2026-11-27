import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, NeedsYou, SectionBar, StatusPill } from "@/components/ffsa";
import { getVisaAccess } from "@/lib/visas/access";
import { formatDay } from "@/lib/visas/display";
import {
  STANDING_SOON_DAYS,
  standingDueOn,
  standingNeedingAttention,
  standingState,
  type StandingDocument,
} from "@/lib/visas/standing";
import { getVisaStandingDocuments } from "@/services/visas";
import { StandingAdd, StandingEdit, type StandingRow } from "./standing-form";

// FFSA's standing documents (500): the papers that go with every
// application, with the dates they run out. Global legal only. The file
// paths never leave the server; the page only says whether there's a file.

const STATE_PILL = {
  no_file: { tone: "warn", text: "No file yet" },
  expired: { tone: "warn", text: "Run out" },
  soon: { tone: "warn", text: "Runs out soon" },
  ok: { tone: "quiet", text: "Up to date" },
} as const;

export default async function FfsaDocumentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getVisaAccess(supabase, user.id);
  if (!access.globalLegal) redirect("/schools/visas");

  const { data } = await getVisaStandingDocuments(supabase);
  const docs = (data ?? []) as StandingDocument[];
  const live = docs.filter((d) => d.is_active);
  const retired = docs.filter((d) => !d.is_active);
  const attention = standingNeedingAttention(docs);

  const toRow = (d: StandingDocument): StandingRow => ({
    id: d.id,
    label: d.label,
    description: d.description,
    certified_on: d.certified_on,
    renew_months: d.renew_months,
    expires_on: d.expires_on,
    for_students: d.for_students,
    sort_order: d.sort_order,
    is_active: d.is_active,
    has_file: !!d.storage_path,
  });

  const row = (d: StandingDocument) => {
    const state = standingState(d);
    const due = standingDueOn(d);
    return (
      <li key={d.id} className="flex flex-col gap-2 border-b border-rule px-5 py-3 last:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold">{d.label}</div>
            {d.description && <div className="text-[13px] text-[#55524A]">{d.description}</div>}
            <div className="mono-label mt-1">
              {d.certified_on ? `Certified ${formatDay(d.certified_on)}` : d.storage_path ? "Uploaded" : "Not uploaded"}
              {due ? ` · ${state === "expired" ? "ran out" : "runs out"} ${formatDay(due)}` : ""}
              {d.for_students ? " · students get this" : ""}
            </div>
          </div>
          {d.is_active ? (
            <StatusPill tone={STATE_PILL[state].tone}>{STATE_PILL[state].text}</StatusPill>
          ) : (
            <StatusPill tone="quiet">Retired</StatusPill>
          )}
        </div>
        <StandingEdit doc={toRow(d)} />
      </li>
    );
  };

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Visas · Legal"
        title="FFSA documents"
        actions={
          <Link href="/schools/visas" className="mono-label underline-offset-4 hover:underline">
            All cases
          </Link>
        }
      />
      {attention.length > 0 && (
        <NeedsYou>
          {attention.length === 1
            ? "1 of FFSA's documents needs a file or a new copy"
            : `${attention.length} of FFSA's documents need a file or a new copy`}
        </NeedsYou>
      )}
      <div className="flex flex-col gap-6 px-5 py-6 md:px-8 md:py-7">
        <p className="max-w-[720px] text-[14px]">
          The papers FFSA sends with every application. The Hub warns {STANDING_SOON_DAYS} days before a certified copy
          needs re-certifying or a document runs out. Only you see this list. A document you give to students can be
          downloaded by a student while their case is approved or lodged (it stops once the embassy decides). Every
          time one is opened, by you or a student, it&apos;s recorded.
        </p>

        <div className="border border-ink">
          <SectionBar title="In use" meta={`${live.length}`} />
          <ul>
            {live.map(row)}
            {live.length === 0 && <li className="px-5 py-4 text-[14px] text-[#55524A]">No documents yet.</li>}
          </ul>
        </div>

        <div className="border border-ink">
          <SectionBar title="Add a document" />
          <div className="px-5 py-4 md:px-6">
            <StandingAdd />
          </div>
        </div>

        {retired.length > 0 && (
          <div className="border border-ink">
            <SectionBar title="Retired" meta={`${retired.length}`} />
            <ul>{retired.map(row)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
