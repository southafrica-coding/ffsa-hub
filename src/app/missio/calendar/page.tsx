import type { Metadata } from "next";
import { MissioCalendarPage } from "@/components/missio/calendar/calendar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Calendar · Missio" },
};

export default function MissioCalendarRoute() {
  return <MissioCalendarPage />;
}
