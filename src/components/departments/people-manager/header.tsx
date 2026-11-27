import Link from "next/link";
import pw from "@/components/song-library/pw.module.css";
import { pmPaths } from "./client";
import pm from "./pm.module.css";

export type PeopleSegment = "roster" | "mine" | "manager";

export type DepartmentTabLink = { key: string; label: string; href: string };

/**
 * Roster | My time off | People Manager, under the department's People tab.
 * "My time off" only for members (who can ask for leave); "People Manager"
 * only for leaders and admins (who see the department's queue).
 */
export function PeopleSubnav({
  slug,
  active,
  canRequest,
  canManage,
}: {
  slug: string;
  active: PeopleSegment;
  canRequest: boolean;
  canManage: boolean;
}) {
  const paths = pmPaths(slug);
  if (!canRequest && !canManage) return null;
  return (
    <nav className={pm.seg2} aria-label="People">
      <Link href={paths.roster} aria-current={active === "roster" ? "page" : undefined}>
        Roster
      </Link>
      {canRequest ? (
        <Link href={paths.mine} aria-current={active === "mine" ? "page" : undefined}>
          My time off
        </Link>
      ) : null}
      {canManage ? (
        <Link href={paths.home} aria-current={active === "manager" ? "page" : undefined}>
          People Manager
        </Link>
      ) : null}
    </nav>
  );
}

/** Back link, department masthead, the department's tabs (People current) and the People segments. */
export function PmHeader({
  slug,
  departmentName,
  tabs,
  active,
  canRequest,
  canManage,
  back,
  eyebrow = "Department",
  title,
}: {
  slug: string;
  departmentName: string;
  tabs: DepartmentTabLink[];
  active: PeopleSegment | null;
  canRequest: boolean;
  canManage: boolean;
  back?: { href: string; label: string };
  eyebrow?: string;
  title?: string;
}) {
  const backLink = back ?? { href: "/departments", label: "Departments" };
  return (
    <>
      <Link className={pw.back} href={backLink.href}>
        <span aria-hidden="true">←</span> {backLink.label}
      </Link>
      <div className={pw.pagehead}>
        <div className={pw.eyebrow}>{eyebrow}</div>
        <h1 className={pw.title}>{title ?? departmentName}</h1>
      </div>
      {active ? (
        <>
          {tabs.length > 0 ? (
            <nav className={pm.dtabs} aria-label="Department">
              {tabs.map((tab) => (
                <Link key={tab.key} href={tab.href} aria-current={tab.key === "people" ? "page" : undefined}>
                  {tab.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <PeopleSubnav slug={slug} active={active} canRequest={canRequest} canManage={canManage} />
        </>
      ) : null}
    </>
  );
}
