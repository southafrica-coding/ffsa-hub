"use client";

import Link from "next/link";
import { CAMPUS_LABEL } from "../access";
import shell from "../shell.module.css";
import { nameList } from "./format";
import type { HouseCampus, PersonRef } from "./types";
import styles from "./house-churches.module.css";

export function AllHousesLink() {
  return (
    <Link href="/missio/house-churches" className={styles.back}>
      <ChevronIcon />
      All houses
    </Link>
  );
}

export function CampusTag({ campus }: { campus: HouseCampus }) {
  return <span className={shell.tag}>{CAMPUS_LABEL[campus]}</span>;
}

export function RoleBlock({ label, people }: { label: string; people: PersonRef[] }) {
  const text = nameList(people);
  return (
    <div className={styles.roleBlock}>
      <div className={styles.roleLabel}>{label}</div>
      <div className={text === "No one yet" ? styles.quiet : undefined}>{text}</div>
    </div>
  );
}

export function MeetingMeta({ day, place }: { day: string | null; place: string | null }) {
  const when = day?.trim() ?? "";
  const where = place?.trim() ?? "";
  if (!when && !where) return null;
  return (
    <p className={styles.metaLine}>
      {when ? (
        <span>
          <CalendarIcon />
          {when}
        </span>
      ) : null}
      {where ? (
        <span>
          <PinIcon />
          {where}
        </span>
      ) : null}
    </p>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="1" />
      <path d="M8 3.5V7M16 3.5V7M4 10h16" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  );
}
