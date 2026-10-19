import { ItemCardSkeleton } from "./_components/store-ui";

export default function Loading() {
  return (
    <main aria-busy="true">
      <div className="border-b border-[color:var(--hire-line)] px-[18px] pb-6 pt-10 md:px-14 md:pb-16 md:pt-24">
        <div className="h-32 w-64 animate-pulse rounded bg-[color:var(--hire-surface2)] md:h-64 md:w-[640px]" />
        <div className="mt-5 h-[50px] animate-pulse rounded-lg bg-[color:var(--hire-surface2)] md:w-[640px]" />
      </div>
      <div className="pt-6 md:grid md:grid-cols-4 md:gap-5 md:px-10 md:pt-14">
        {Array.from({ length: 4 }, (_, i) => (
          <ItemCardSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
