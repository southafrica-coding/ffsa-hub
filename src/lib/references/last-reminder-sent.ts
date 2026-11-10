import { createElement } from "react";
import { lastReminderLabel } from "./manual-reminder";

export function LastReminderSent({
  sentAt,
  nowMs,
}: {
  sentAt: string | null;
  nowMs?: number;
}) {
  const label = lastReminderLabel(sentAt, nowMs);
  if (!label) return null;
  return createElement("p", { className: "text-xs text-muted-foreground" }, label);
}
