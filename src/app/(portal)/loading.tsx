// Shown automatically by Next.js for every (portal) route that doesn't define
// its own loading.tsx — the same skeleton as (admin)/loading.tsx. Without it a
// click between personal pages left the previous page frozen on screen until
// the next one had fully rendered.

export default function PortalLoading() {
  return (
    <div className="space-y-6 animate-pulse px-5 py-6 md:px-8">
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
      </div>
    </div>
  );
}
