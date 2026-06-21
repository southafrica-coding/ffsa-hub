"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { StatusPill } from "../ui";

// Lets the header status pill and the action buttons share one optimistic
// status, so an approve/deny/cancel flips the UI instantly (before the server
// round-trip), then router.refresh() reconciles the rest of the page.

type BookingStatusCtx = {
  status: string;
  setStatus: (status: string) => void;
};

const Ctx = createContext<BookingStatusCtx | null>(null);

export function BookingStatusProvider({
  initialStatus,
  children,
}: {
  initialStatus: string;
  children: ReactNode;
}) {
  const [status, setStatus] = useState(initialStatus);
  return <Ctx.Provider value={{ status, setStatus }}>{children}</Ctx.Provider>;
}

export function useBookingStatus(): BookingStatusCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useBookingStatus must be used within BookingStatusProvider");
  }
  return ctx;
}

export function LiveStatusPill({ className }: { className?: string }) {
  const { status } = useBookingStatus();
  return <StatusPill status={status} className={className} />;
}
