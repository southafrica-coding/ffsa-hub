import { cn } from "@/lib/utils/cn";
import { formatZarFromCents } from "@/lib/format/money";

/** Right-aligned tabular rand amount. Whole rands unless `showCents`. Negatives are red with a minus sign. */
export function MoneyCell({
  cents,
  showCents = false,
  className,
}: {
  /** Integer cents. Rounded to the nearest rand unless `showCents`. */
  cents: number;
  showCents?: boolean;
  className?: string;
}) {
  const text = formatZarFromCents(cents, { showCents });
  const negative = text.startsWith("-");
  return (
    <span
      className={cn(
        "block text-right font-mono text-ui tabular-nums",
        negative ? "text-danger" : "text-ink",
        className
      )}
    >
      {text}
    </span>
  );
}
