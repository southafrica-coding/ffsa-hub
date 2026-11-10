import { cn } from "@/lib/utils/cn";
import { formatZarFromCents } from "@/lib/format/money";

/** Right-aligned tabular rand amount. Negatives are red with a minus sign. */
export function MoneyCell({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  const negative = Number.isFinite(cents) && cents < 0;
  return (
    <span
      className={cn(
        "block text-right font-mono text-ui tabular-nums",
        negative ? "text-danger" : "text-ink",
        className
      )}
    >
      {formatZarFromCents(cents)}
    </span>
  );
}
