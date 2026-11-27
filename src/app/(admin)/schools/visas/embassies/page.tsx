import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
import { getVisaAccess } from "@/lib/visas/access";
import { countryName, embassyFacts, type Embassy } from "@/lib/visas/embassies";
import { countries } from "@/lib/countries";
import { getVisaEmbassies } from "@/services/visas";
import { EmbassyEdit, EmbassyForm } from "./embassy-form";

// Legal's embassy profiles (500): where students apply, who letters are
// addressed to, and each mission's own rules. Global legal only.

export default async function EmbassiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getVisaAccess(supabase, user.id);
  if (!access.globalLegal) redirect("/schools/visas");

  const { data } = await getVisaEmbassies(supabase);
  const embassies = (data ?? []) as Embassy[];
  const live = embassies.filter((e) => e.is_active);
  const retired = embassies.filter((e) => !e.is_active);
  const countryList = countries.map((c) => ({ iso2: c.iso2, name: c.name }));

  const row = (e: Embassy) => (
    <li key={e.id} className="flex flex-col gap-2 border-b border-rule px-5 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">
          {e.name}, {e.city}
        </div>
        <div className="mono-label mt-1">
          {countryName(e.country_iso)}
          {e.addressee ? ` · ${e.addressee}` : " · No addressee yet"}
        </div>
        {embassyFacts(e).length > 0 && (
          <ul className="mt-1 text-[13px] text-[#55524A]">
            {embassyFacts(e).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
      {(!e.is_active || (e.accepts_scan == null && e.needs_original == null)) && (
        <div className="flex flex-wrap items-center gap-2">
          {!e.is_active && <StatusPill tone="quiet">Retired</StatusPill>}
          {e.accepts_scan == null && e.needs_original == null && e.is_active && (
            <StatusPill tone="warn">Scan rule not known</StatusPill>
          )}
        </div>
      )}
      <div>
        <EmbassyEdit embassy={e} countries={countryList} />
      </div>
    </li>
  );

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Visas · Legal"
        title="Embassies"
        actions={
          <Link href="/schools/visas" className="mono-label underline-offset-4 hover:underline">
            All cases
          </Link>
        }
      />
      <div className="flex flex-col gap-6 px-5 py-6 md:px-8 md:py-7">
        <p className="max-w-[720px] text-[14px]">
          The South African missions students apply at. When a case has its embassy, the letter form fills in who
          it&apos;s addressed to and the city. Students and school leaders see the notes and the scan, page and time
          rules for their embassy.
        </p>

        <div className="border border-ink">
          <SectionBar title="In use" meta={`${live.length}`} />
          <ul>
            {live.map(row)}
            {live.length === 0 && (
              <li className="px-5 py-4 text-[14px] text-[#55524A]">
                No embassies yet. Add the ones this year&apos;s students apply at.
              </li>
            )}
          </ul>
        </div>

        <div className="border border-ink">
          <SectionBar title="Add an embassy" />
          <div className="px-5 py-4 md:px-6">
            <EmbassyForm countries={countryList} />
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
