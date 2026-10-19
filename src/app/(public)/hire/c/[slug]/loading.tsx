import { ItemCardSkeleton } from "../../_components/store-ui";

// Skeletons while availability is counted (frame 46a's last row).
export default function Loading() {
  return (
    <main aria-busy="true">
      <div className="border-b border-[color:var(--hire-line)] px-[18px] pb-4 pt-4 md:px-10 md:pb-7 md:pt-9">
        <div className="h-12 w-48 animate-pulse rounded bg-[color:var(--hire-surface2)] md:h-20 md:w-80" />
        <div className="mt-3 h-[50px] animate-pulse rounded-lg bg-[color:var(--hire-surface2)] md:w-[560px]" />
      </div>
      <div className="md:grid md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="hidden border-r border-[color:var(--hire-line)] md:block" />
        <div className="md:grid md:grid-cols-2 md:gap-5 md:px-10 md:pt-6 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <ItemCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
