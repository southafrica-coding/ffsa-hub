import { cn } from "@/lib/utils/cn";

// A product photo, or a quiet placeholder when there isn't one yet.
export function Photo({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-[color:var(--hire-surface2)]", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.14em] text-[color:var(--hire-dim)]">
          No photo yet
        </span>
      )}
    </div>
  );
}
