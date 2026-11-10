"use client";

export function RouteError({ reset }: { reset: () => void }) {
  return (
    <div className="px-5 py-8 md:px-8">
      <p className="font-medium">This page did not load.</p>
      <button type="button" className="mt-4 text-sm underline" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
