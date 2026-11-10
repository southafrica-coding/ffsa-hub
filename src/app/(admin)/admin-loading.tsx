// Skeleton for one admin route. It used to live at (admin)/loading.tsx, which
// wrapped every admin page — including departments — in Suspense. notFound()
// inside that boundary was streamed as HTTP 200. Departments has no loading
// file so its empty-list 404 is sent before the response starts.

export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="h-4 w-24 rounded bg-muted" />
      </div>

      <div className="space-y-3">
        <div className="h-10 w-full rounded bg-muted/60" />
        <div className="h-16 w-full rounded bg-muted/40" />
        <div className="h-16 w-full rounded bg-muted/40" />
        <div className="h-16 w-full rounded bg-muted/40" />
        <div className="h-16 w-full rounded bg-muted/40" />
      </div>
    </div>
  );
}
