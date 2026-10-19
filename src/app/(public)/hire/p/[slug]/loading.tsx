// Skeleton while the item's availability and calendar are counted.
export default function Loading() {
  const block = "animate-pulse bg-[color:var(--hire-surface2)]";
  return (
    <main aria-busy="true" className="md:grid md:grid-cols-[minmax(0,1fr)_480px] md:gap-12 md:px-10 md:pt-10">
      <div className={`${block} h-[290px] md:h-[520px] md:rounded-[8px]`} />
      <div className="flex flex-col gap-4 px-[18px] pt-4 md:px-0 md:pt-0">
        <div className={`${block} h-3 w-40 rounded`} />
        <div className={`${block} h-14 w-48 rounded-[4px] md:h-20 md:w-72`} />
        <div className={`${block} h-16 rounded-[8px]`} />
        <div className={`${block} h-40 rounded-[8px]`} />
      </div>
    </main>
  );
}
