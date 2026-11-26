import Link from "next/link";
import pw from "./pw.module.css";
import { ServiceBand } from "@/components/departments/songwriting/header";
import { SERVICE_LIBRARY_PATHS } from "./paths";

/** Masthead for the Song Library as a Hub Service (/song-library). */
export function ServiceLibraryHeader({ ownerName, sub }: { ownerName: string | null; sub?: boolean }) {
  return (
    <>
      <Link className={pw.back} href={sub ? SERVICE_LIBRARY_PATHS.home : "/services"}>
        <span aria-hidden="true">←</span> {sub ? "Library" : "Services"}
      </Link>
      <div className={pw.pagehead}>
        <div className={pw.eyebrow}>Hub service</div>
        <h1 className={pw.title}>Song Library</h1>
      </div>
      <ServiceBand ownerName={ownerName} />
    </>
  );
}
