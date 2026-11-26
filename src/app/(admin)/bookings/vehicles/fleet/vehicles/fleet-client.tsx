"use client";

// The interactive bits of the Vehicles list: "Show all" on Needs attention, and
// "Log a km reading" with a vehicle picker.

import { useState } from "react";
import Link from "next/link";
import { KmDialog, type KmVehicle } from "../_components/km-dialog";
import { SevDot, sevLabel, vehicleHref } from "../_components/ui";
import { MastheadButton } from "@/components/ffsa";
import type { FleetAlert } from "./model";

const SHOWN = 8;

export function AttentionList({ alerts }: { alerts: FleetAlert[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? alerts : alerts.slice(0, SHOWN);
  return (
    <>
      <ul className="divide-y divide-rule">
        {shown.map((a, i) => (
          <li key={i}>
            <Link
              href={vehicleHref(a.vehicleId, a.tab)}
              className="flex min-h-11 gap-3 px-5 py-3 text-[14px] leading-snug hover:bg-bone md:px-8"
            >
              <SevDot sev={a.sev} />
              <span className="min-w-0 flex-1">
                <span className="sr-only">{sevLabel(a.sev)}: </span>
                <span className="font-medium">{a.vehicleName}</span>
                <span className="text-[#55524A]"> · {a.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {alerts.length > SHOWN && (
        <div className="border-t border-rule px-5 py-1 md:px-8">
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="min-h-11 font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline"
          >
            {all ? "Show fewer" : `Show all ${alerts.length}`}
          </button>
        </div>
      )}
    </>
  );
}

export function LogKmButton({ vehicles, today }: { vehicles: KmVehicle[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MastheadButton tone="outline" onClick={() => setOpen(true)}>
        Log a km reading
      </MastheadButton>
      <KmDialog open={open} onOpenChange={setOpen} vehicles={vehicles} today={today} />
    </>
  );
}
