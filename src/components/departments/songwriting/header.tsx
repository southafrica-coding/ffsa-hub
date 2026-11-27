import Link from "next/link";
import pw from "@/components/song-library/pw.module.css";
import { EditBand } from "./edit-band";

export const SONGWRITING_TABS = ["overview", "trainings", "nations", "follow-up", "library"] as const;
export type SongwritingTab = (typeof SONGWRITING_TABS)[number];

const TAB_LABEL: Record<SongwritingTab, string> = {
  overview: "Overview",
  trainings: "Trainings",
  nations: "Nations",
  "follow-up": "Follow-up",
  library: "Library",
};

/** The department that owns Songwriting (417's pw_can_access_songwriting). */
export const SONGWRITING_DEPARTMENT_SLUG = "prayer_and_worship";

export function songwritingHref(slug: string, tab: SongwritingTab = "overview"): string {
  const base = `/departments/${encodeURIComponent(slug)}/songwriting`;
  return tab === "overview" ? base : `${base}/${tab}`;
}

export function trainingHref(slug: string, id: string | "new"): string {
  return `${songwritingHref(slug, "trainings")}/${encodeURIComponent(id)}`;
}

/** /nations/new, /nations/:id (the nation page) and /nations/:id/edit. */
export function nationHref(slug: string, id: string | "new", edit = false): string {
  const base = `${songwritingHref(slug, "nations")}/${encodeURIComponent(id)}`;
  return edit && id !== "new" ? `${base}/edit` : base;
}

/** /follow-up/new, /follow-up/:id (the lead and its logged contacts) and /follow-up/:id/edit. */
export function leadHref(slug: string, id: string | "new", edit = false): string {
  const base = `${songwritingHref(slug, "follow-up")}/${encodeURIComponent(id)}`;
  return edit && id !== "new" ? `${base}/edit` : base;
}

/**
 * Back link, masthead, the five-tab subnav, and one band under it:
 * "edit" (who can add and edit, from the API's viewer.edit_rule) or
 * "service" (the Library is a Hub Service open to the whole base).
 */
export function SongwritingHeader({
  slug,
  departmentName,
  active,
  band,
  back,
}: {
  slug: string;
  departmentName: string;
  active: SongwritingTab;
  band: "edit" | "service";
  back?: { href: string; label: string };
}) {
  const backLink = back ?? { href: `/departments/${encodeURIComponent(slug)}`, label: departmentName };
  return (
    <>
      <Link className={pw.back} href={backLink.href}>
        <span aria-hidden="true">←</span> {backLink.label}
      </Link>
      <div className={pw.pagehead}>
        <div className={pw.eyebrow}>{active === "library" ? `${departmentName} · Songwriting` : `${departmentName} · Op. Dandelion`}</div>
        <h1 className={pw.title}>Songwriting</h1>
      </div>
      <nav className={pw.subnav} aria-label="Songwriting">
        {SONGWRITING_TABS.map((tab) => (
          <Link key={tab} href={songwritingHref(slug, tab)} aria-current={tab === active ? "page" : undefined}>
            {TAB_LABEL[tab]}
          </Link>
        ))}
      </nav>
      {band === "edit" ? (
        <EditBand slug={slug} departmentName={departmentName} />
      ) : (
        <ServiceBand ownerName={departmentName} />
      )}
    </>
  );
}

export function ServiceBand({ ownerName }: { ownerName: string | null }) {
  return (
    <div className={`${pw.band} ${pw.bandLeft}`}>
      <span className={pw.bandTag}>HUB SERVICE</span>
      <span>Open to the whole base.{ownerName ? ` Managed by ${ownerName}.` : ""}</span>
    </div>
  );
}
