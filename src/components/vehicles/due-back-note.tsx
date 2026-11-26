import { dueBackHint, RETURN_BY } from "@/lib/vehicles/return-day";
import { HOLD_PURPOSE, HOLD_WORKING_DAYS } from "@/lib/vehicles/hold";

/**
 * The due-back rule, beside the "Last day you need it" field on both booking forms
 * (Gideon, 24 Nov 2026: "a small explanation … that will clearly explain this").
 */
export function DueBackNote({
  lastDay,
  purpose,
  plain = false,
  className = "",
}: {
  lastDay: string;
  /** "international_team" adds the hold after the booking (lib/vehicles/hold.ts). */
  purpose?: string | null;
  /** The public request page keeps its own look: no Hub colours. */
  plain?: boolean;
  className?: string;
}) {
  const box = plain ? "border-l-2 border-current" : "border-l-2 border-foreground bg-bone";
  const soft = plain ? "opacity-70" : "text-muted-foreground";
  return (
    <div className={`${box} px-3 py-2 text-xs leading-relaxed ${className}`}>
      <p className="font-semibold">{dueBackHint(lastDay)}</p>
      <p className={`mt-1 ${soft}`}>
        Choose the last day you&apos;ll drive the vehicle. You bring it back the next morning, before {RETURN_BY}:
        washed, with a full tank and the return inspection done. That morning is kept free for you, so you
        don&apos;t need to book it. For example: last day Wednesday, back on Thursday before {RETURN_BY}.
      </p>
      {purpose === HOLD_PURPOSE && (
        <p className={`mt-1 ${soft}`}>
          International teams: after it&apos;s back, the vehicle stays with us for {HOLD_WORKING_DAYS} working days (weekends and public holidays don&apos;t count) for the
          inspection and a full valet wash, so it can&apos;t be booked again straight away.
        </p>
      )}
      <p className={`mt-1 ${soft}`}>
        Done sooner? Ask the Vehicle Coordinator for an early return.
      </p>
    </div>
  );
}
