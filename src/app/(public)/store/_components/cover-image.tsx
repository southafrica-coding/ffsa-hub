"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

// A product cover in an A4 box (210 × 297), reserved before the image loads
// so nothing shifts. `src` comes from coverSrcFor (src/lib/store/cover.ts):
// the uploaded cover, or the signed page-1 preview render. With no src, or
// if the image fails (e.g. the signed link expired in a long-open tab), it
// draws the title box. The title box is aria-hidden: every surface that
// shows a cover also shows the title next to it.
export function CoverImage({
  src,
  title,
  className,
  priority = false,
  compact = false,
}: {
  src: string | null;
  title: string;
  className?: string;
  /** The page's main image (product page): load eagerly, high priority. */
  priority?: boolean;
  /** A thumbnail (cart line): the fallback is the ink box and tick, no title text. */
  compact?: boolean;
}) {
  // Remember which src failed, so a fresh signed link gets its own try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const show = !!src && src !== failedSrc;
  return (
    <div className={cn("relative aspect-[210/297] w-full overflow-hidden bg-bone-2", className)}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt={`Cover of ${title}`}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <div aria-hidden="true" className={cn("flex h-full w-full min-w-0 flex-col justify-end bg-[#0A0A0A]", compact ? "p-1.5" : "p-4")}>
          {/* Literal near-black, not bg-ink: in dark mode ink flips to bone, which would wash out the white title. */}
          {!compact && <span className="break-words font-display text-[clamp(22px,5vw,34px)] font-black uppercase leading-[0.9] text-white">{title}</span>}
          <span className={cn("h-[3px] bg-yellow", compact ? "w-4" : "mt-3 w-8")} />
        </div>
      )}
    </div>
  );
}
