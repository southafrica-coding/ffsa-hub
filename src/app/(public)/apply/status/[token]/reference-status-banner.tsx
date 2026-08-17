import { PUBLIC_SHELL_TOKENS } from "@/components/public-form-shell";
import {
  referenceCompleteness,
  type ReferenceCompleteness,
} from "@/lib/references/reference-status-copy";

const T = PUBLIC_SHELL_TOKENS;

// Amber matches the tracker's pending-reference count and the
// waiting_for_references badge foreground.
const TONE_COLOR: Record<ReferenceCompleteness["tone"], string> = {
  pending: "hsl(42 95% 65%)",
  complete: T.green,
};

/**
 * The headline answer to "what's happening with my application?" — driven by
 * live reference counts, not by application_responses.status (which staff move
 * by hand and which therefore lags behind references arriving).
 *
 * Renders nothing for a program with no reference slots. The caller also
 * suppresses it once a decision or interview stage has been reached.
 */
export function ReferenceStatusBanner({
  total,
  submitted,
  missingLabels,
}: {
  total: number;
  submitted: number;
  missingLabels: string[];
}) {
  const state = referenceCompleteness({ total, submitted, missingLabels });
  if (!state) return null;

  const color = TONE_COLOR[state.tone];

  return (
    <div
      className="rounded-lg p-4 mb-6"
      style={{
        background: `${color}1a`,
        border: `1px solid ${color}40`,
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, color }}>{state.title}</p>
      <p style={{ fontSize: 12, color: T.textDim, marginTop: 4, lineHeight: 1.5 }}>
        {state.body}
      </p>
    </div>
  );
}
