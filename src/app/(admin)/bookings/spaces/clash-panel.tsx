"use client";

// The clash panel every space-booking form shows when the time is taken: who
// holds the space, for what, and when, so the person can talk to them or pick
// another time. Space managers and admins also get "Book anyway", which needs
// a reason (saved on the booking and in the override audit, migration 403).

import { useId } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { humanDate } from "@/lib/bookings/dates";
import { approveLead, blockLead, type Conflict } from "@/lib/bookings/conflict-messages";
import { OVERRIDE_REASON_MAX } from "@/lib/bookings/override";

export type ClashConflict = Conflict;

const SHOWN = 8;

export function ClashPanel({
  conflicts,
  venueName,
  canOverride,
  overriding,
  onOverridingChange,
  reason,
  onReasonChange,
  cannotOverrideHint,
  variant = "book",
}: {
  conflicts: ClashConflict[];
  venueName?: string | null;
  canOverride: boolean;
  overriding: boolean;
  onOverridingChange: (next: boolean) => void;
  reason: string;
  onReasonChange: (next: string) => void;
  /** Said plainly to someone who can't book over it (e.g. an approver). */
  cannotOverrideHint?: string;
  /** "approve" uses wording for a decision, not "pick another time". */
  variant?: "book" | "approve";
}) {
  const reasonId = useId();
  const counterId = useId();
  if (conflicts.length === 0) return null;

  const lead =
    variant === "approve" ? approveLead(conflicts, venueName) : blockLead(conflicts, venueName);

  return (
    <div role="alert" className="min-w-0 border border-ink bg-bone text-sm">
      <p className="flex items-center gap-2 border-b border-rule px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
        <Ban className="h-3.5 w-3.5 shrink-0" />
        {conflicts.length === 1 ? "This time is taken" : "These times are taken"}
      </p>
      <div className="space-y-3 p-3">
        <p className="break-words text-[color:var(--text-primary)]">{lead}</p>

        {conflicts.length > 1 && (
          <ul className="divide-y divide-rule border-y border-rule">
            {conflicts.slice(0, SHOWN).map((c, i) => (
              <li key={`${c.existingId}-${i}`} className="min-w-0 py-2">
                <p className="break-words font-medium text-[color:var(--text-primary)]">
                  {c.who ?? "Someone"}{" "}
                  <span className="font-normal text-[color:var(--text-secondary)]">
                    (&ldquo;{c.existingTitle}&rdquo;)
                  </span>
                </p>
                <p className="text-xs text-[color:var(--text-secondary)]">
                  {humanDate(c.date)} · {c.existingWindow}
                </p>
              </li>
            ))}
            {conflicts.length > SHOWN && (
              <li className="py-2 text-xs text-[color:var(--text-secondary)]">
                and {conflicts.length - SHOWN} more
              </li>
            )}
          </ul>
        )}

        {!canOverride && cannotOverrideHint && (
          <p className="break-words border-t border-rule pt-3 text-xs text-[color:var(--text-secondary)]">
            {cannotOverrideHint}
          </p>
        )}

        {canOverride && !overriding && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule pt-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 bg-white"
              onClick={() => onOverridingChange(true)}
            >
              Book anyway
            </Button>
            <span className="text-xs text-[color:var(--text-secondary)]">
              As a space manager you can book over this, with a reason.
            </span>
          </div>
        )}

        {canOverride && overriding && (
          <div className="space-y-2 border-t border-rule pt-3">
            <Label htmlFor={reasonId}>Why does this need to go ahead? *</Label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value.slice(0, OVERRIDE_REASON_MAX))}
              maxLength={OVERRIDE_REASON_MAX}
              required
              rows={3}
              aria-describedby={counterId}
              placeholder="e.g. Agreed with the other booker; their meeting moves to Office 1."
              className="flex w-full bg-white"
            />
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs text-[color:var(--text-secondary)]">
                Saved with the booking for the space managers to see.
              </p>
              <p id={counterId} className="font-mono text-[10px] tabular-nums text-[color:var(--text-secondary)]">
                {reason.length} / {OVERRIDE_REASON_MAX}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-0 text-xs"
              onClick={() => {
                onOverridingChange(false);
                onReasonChange("");
              }}
            >
              Don&apos;t book over it
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** What the forms send when a manager books over a clash. */
export function overrideBody(overriding: boolean, reason: string) {
  return overriding && reason.trim() ? { override: { reason: reason.trim() } } : {};
}
