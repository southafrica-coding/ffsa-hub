import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMinistries } from "@/services/ministries";
import { callerIsAdmin, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import { NewMinistryButton } from "./new-ministry-button";
import { Masthead, StatusPill } from "@/components/ffsa";
import {
  MINISTRY_TYPES,
  MINISTRY_TYPE_SECTION_LABELS,
  ministryTypeOf,
} from "@/lib/ministries/ministry-type";

export default async function MinistryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isAdmin = await callerIsAdmin(supabase, user.id);
  const ledIds = isAdmin ? [] : await getLedMinistryIds(supabase, user.id);
  if (!isAdmin && ledIds.length === 0) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: ministries } = await listMinistries(admin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visible = ((ministries ?? []) as any[]).filter(
    (m) => isAdmin || ledIds.includes(m.id)
  );

  // Split into Main / Part-time sections, keeping each section in the order
  // listMinistries already returned. A section with no ministries renders
  // nothing at all, so a Hub with only main ministries looks unchanged.
  const sections = MINISTRY_TYPES.map((type) => ({
    type,
    label: MINISTRY_TYPE_SECTION_LABELS[type],
    items: visible.filter((m) => ministryTypeOf(m.ministry_type) === type),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`People · ${visible.length} ministr${visible.length === 1 ? "y" : "ies"}${!isAdmin ? " you lead" : ""}`}
        title="Ministries"
        actions={isAdmin ? <NewMinistryButton /> : undefined}
      />

      {visible.length === 0 ? (
        <div className="px-5 py-12 text-center md:px-8">
          <p className="mono-label">No ministries yet</p>
        </div>
      ) : (
        // Two-line rows rather than a rounded card grid: a ministry is a
        // name, a blurb and a headcount, which is a row. Rows are grouped
        // under a Main / Part-time heading — but only once there is more
        // than one group, so the common case reads as a single plain list.
        sections.map((section) => (
        <div key={section.type}>
          {sections.length > 1 && (
            <div className="mono-label border-b border-rule bg-[#F7F5EE] px-5 py-2 md:px-8">
              {section.label}
            </div>
          )}
        <ul>
          {section.items.map((m) => {
            const count = m.staff_ministry_members?.[0]?.count ?? 0;
            return (
              <li key={m.id} className="border-b border-rule">
                <Link
                  href={`/ministry/${m.id}`}
                  className="flex min-h-[48px] items-center justify-between gap-4 px-5 py-3.5 hover:bg-[#F7F5EE] md:px-8"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="truncate font-display text-[17px] font-black uppercase leading-none text-ink">
                        {m.name}
                      </span>
                      {!m.is_active && <StatusPill tone="quiet">Retired</StatusPill>}
                    </div>
                    <div className="mono-label mt-1.5 truncate">
                      {count} {count === 1 ? "person" : "people"}
                      {m.description ? ` · ${m.description}` : ""}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        </div>
        ))
      )}
    </div>
  );
}
