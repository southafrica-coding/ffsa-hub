"use client";

// Where a case will be lodged (500): the embassy's details and rules, and
// the picker. The student picks until legal approves; legal for the case
// can change it until it's lodged. visa_set_case_embassy checks both.

import { useState } from "react";
import { SectionBar } from "@/components/ffsa";
import { ErrorLine, VisaButton, openStandingDocument, useVisaPost } from "@/components/visas/visa-ui";
import { countryName, embassyFacts, type Embassy } from "@/lib/visas/embassies";

export type EmbassyOption = Pick<Embassy, "id" | "name" | "city" | "country_iso">;

export function EmbassyPanel({
  caseId,
  embassy,
  options,
  canChange,
  audience,
}: {
  caseId: string;
  embassy: Embassy | null;
  options: EmbassyOption[];
  canChange: boolean;
  audience: "staff" | "student";
}) {
  const { post, busy, error } = useVisaPost();
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState(embassy?.id ?? "");

  // Grouped by country, countries in name order.
  const byCountry = new Map<string, EmbassyOption[]>();
  for (const o of options) byCountry.set(o.country_iso, [...(byCountry.get(o.country_iso) ?? []), o]);
  const groups = [...byCountry.entries()].sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0])));

  return (
    <div className="border border-ink">
      <SectionBar title="Embassy" />
      <div className="flex flex-col gap-3 px-5 py-4">
        {embassy ? (
          <div>
            <div className="text-[14px] font-semibold">
              {embassy.name}, {embassy.city}
            </div>
            <div className="mono-label mt-1">{countryName(embassy.country_iso)}</div>
            {embassyFacts(embassy).length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-[14px]">
                {embassyFacts(embassy).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            {embassy.notes && (
              <p className="mt-2 whitespace-pre-wrap border-l-[3px] border-rule-strong pl-3 text-[14px]">{embassy.notes}</p>
            )}
            {embassy.website_url && (
              <a
                href={embassy.website_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block break-all text-[14px] underline underline-offset-4"
              >
                The embassy&apos;s website
              </a>
            )}
          </div>
        ) : (
          <p className="text-[14px] text-[#55524A]">
            {audience === "student"
              ? "Choose the South African embassy or consulate where you'll apply. Legal uses it for your letters."
              : "No embassy chosen yet. The student chooses it, or legal can."}
          </p>
        )}

        {canChange && options.length > 0 && !picking && (
          <div>
            <VisaButton tone={embassy ? "outline" : "solid"} onClick={() => setPicking(true)}>
              {embassy ? "Change embassy" : "Choose embassy"}
            </VisaButton>
          </div>
        )}
        {canChange && options.length === 0 && !embassy && (
          <p className="text-[13px] text-[#55524A]">
            {audience === "student"
              ? "Legal hasn't added embassies yet. Ask your school leader."
              : "No embassies set up yet: Visas → Embassies."}
          </p>
        )}
        {picking && (
          <div className="flex flex-col gap-2">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="min-h-11 w-full border border-rule-strong bg-white px-2 text-[14px]"
            >
              <option value="">Choose…</option>
              {groups.map(([iso, list]) => (
                <optgroup key={iso} label={countryName(iso)}>
                  {list.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}, {o.city}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {audience === "staff" && embassy && (
              <p className="text-[13px] text-[#55524A]">Letters already issued keep the old addressee; re-issue them.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <VisaButton
                disabled={busy || !choice || choice === embassy?.id}
                onClick={() => void post(`/api/visas/cases/${caseId}/embassy`, { embassy_id: choice }).then((ok) => ok && setPicking(false))}
              >
                Save
              </VisaButton>
              <VisaButton tone="outline" onClick={() => setPicking(false)}>
                Cancel
              </VisaButton>
            </div>
          </div>
        )}
        <ErrorLine error={error} />
      </div>
    </div>
  );
}

/** FFSA's documents for the student to take to the embassy (approved or lodged cases). */
export function StudentFfsaDocuments({
  caseId,
  documents,
}: {
  caseId: string;
  documents: Array<{ id: string; label: string; description: string | null }>;
}) {
  if (documents.length === 0) return null;
  return (
    <div className="border border-ink">
      <SectionBar title="FFSA's documents" meta={`${documents.length}`} />
      <p className="px-5 pt-4 text-[14px]">Print these and take them with your application.</p>
      <ul className="px-5 pb-2">
        {documents.map((d) => (
          <li key={d.id} className="flex flex-col items-start gap-2 border-b border-rule py-3 last:border-b-0">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">{d.label}</div>
              {d.description && <div className="text-[13px] text-[#55524A]">{d.description}</div>}
            </div>
            <VisaButton tone="outline" onClick={() => void openStandingDocument(d.id, caseId)}>
              Download
            </VisaButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
