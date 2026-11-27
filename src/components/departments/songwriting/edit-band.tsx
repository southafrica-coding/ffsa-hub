"use client";

import pw from "@/components/song-library/pw.module.css";
import { editBandCopy } from "./permissions";
import { useSongwriting } from "./use-songwriting";

/**
 * "Who can add and edit" under the Songwriting tabs. The words follow the
 * API's viewer.edit_rule, so they stay right if the rule flips. Shares the
 * page's GET /songwriting (one request in flight per slug).
 */
export function EditBand({ slug, departmentName }: { slug: string; departmentName: string }) {
  const { data } = useSongwriting(slug);
  return (
    <div className={pw.band}>
      <span>{editBandCopy(data.viewer, departmentName)}</span>
      {data.viewer ? (
        <span className={pw.bandPen} aria-hidden="true">
          ✎ Edit on
        </span>
      ) : null}
    </div>
  );
}
