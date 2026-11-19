"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { ActionButton } from "../_components/ui";
import { fleetFetch } from "../_components/client-api";
import { KmDialog, type KmVehicle } from "../_components/km-dialog";

export interface TutorialStep {
  key: string;
  title: string;
  text: string;
  /** "Open it": the Hub route for the step's screen, or null. */
  href: string | null;
  /** A button that does the step here (only "km-log" today); null without Fleet manage. */
  action: { id: string; label: string } | null;
}

/** The tutorial's steps with a tick each, kept per person (SPEC 8). */
export function Tutorial({
  steps,
  done: initialDone,
  kmVehicles,
  today,
}: {
  steps: TutorialStep[];
  done: string[];
  kmVehicles: KmVehicle[];
  today: string;
}) {
  const [done, setDone] = useState(() => new Set(initialDone));
  const [kmOpen, setKmOpen] = useState(false);

  async function tick(key: string, on: boolean) {
    setDone((d) => {
      const n = new Set(d);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
    try {
      await fleetFetch("/api/vehicles/fleet/guide", { body: { step: key, done: on } });
    } catch (e) {
      setDone((d) => {
        const n = new Set(d);
        if (on) n.delete(key);
        else n.add(key);
        return n;
      });
      toast.error((e as Error).message);
    }
  }

  function act(id: string) {
    if (id === "km-log") setKmOpen(true);
  }

  return (
    <>
      <ol className="divide-y divide-rule border-y border-rule">
        {steps.map((s, i) => {
          const on = done.has(s.key);
          return (
            <li key={s.key} data-step={s.key} className={cn("flex gap-2 py-3", on && "bg-bone")}>
              <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-start justify-center pt-1">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#0A0A0A]"
                  checked={on}
                  onChange={(e) => tick(s.key, e.target.checked)}
                  aria-label={`Done: ${s.title}`}
                />
              </label>
              <div className="min-w-0 flex-1 pr-2">
                <strong className={cn("block text-[15px]", on && "text-[#55524A] line-through decoration-1")}>
                  {i + 1}. {s.title}
                </strong>
                <p className="mt-0.5 text-[14px] leading-relaxed text-[#2B2A26]">{s.text}</p>
                {(s.href || s.action) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.href && (
                      <Link
                        href={s.href}
                        className="inline-flex min-h-11 items-center border border-ink bg-white px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone"
                      >
                        Open it
                      </Link>
                    )}
                    {s.action && <ActionButton onClick={() => act(s.action!.id)}>{s.action.label}</ActionButton>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <KmDialog open={kmOpen} onOpenChange={setKmOpen} vehicles={kmVehicles} today={today} />
    </>
  );
}
