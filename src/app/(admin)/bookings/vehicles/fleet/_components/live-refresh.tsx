"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Every open Fleet page sees everyone's saves within about a second (the Fleet app's
// onSnapshot). Supabase Realtime on the fleet tables (migration 351) → refresh the
// server components. RLS applies to what Realtime sends. Bursts are coalesced, and a
// page that was hidden refreshes when it's shown again.
const TABLES = [
  "fleet_vehicle_details",
  "fleet_workshop_visits",
  "fleet_inspections",
  "fleet_odometer_readings",
  "fleet_providers",
  "fleet_settings",
];

export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missed = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (document.visibilityState !== "visible") {
        missed.current = true;
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };
    let channel = supabase.channel("fleet-live");
    for (const table of TABLES) channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    channel.subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible" && missed.current) {
        missed.current = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
