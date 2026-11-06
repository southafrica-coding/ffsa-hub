"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { DashboardCustomizePanel } from "./dashboard-customize-panel";

export type GridSlot = { key: string; fullWidth: boolean };

// Renders the resolved widget layout, and hosts the Customise entry point.
//
// The widget NODES are rendered on the server and handed in as a record —
// server components passed as props can be placed anywhere by a client
// component, so the existing server-rendered cards keep working untouched
// instead of being rewritten as fetch-based clients.
export function DashboardGrid({
  slots,
  nodes,
}: {
  slots: GridSlot[];
  nodes: Record<string, React.ReactNode>;
}) {
  const [customizing, setCustomizing] = useState(false);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setCustomizing(true)}
          className="chip inline-flex min-h-11 items-center transition-colors duration-150 hover:bg-bone"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Customise
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {slots.map((slot) => {
          const node = nodes[slot.key];
          if (!node) return null;
          return (
            <div
              key={slot.key}
              className={slot.fullWidth ? "lg:col-span-2" : undefined}
            >
              {node}
            </div>
          );
        })}
      </div>

      {customizing && (
        <DashboardCustomizePanel onClose={() => setCustomizing(false)} />
      )}
    </>
  );
}
