import { PUBLIC_SHELL_TOKENS } from "@/components/public-form-shell";
import {
  referenceCompleteness,
  type ReferenceCompleteness,
} from "@/lib/references/reference-status-copy";

const T = PUBLIC_SHELL_TOKENS;

// Amber matches the tracker's pending-reference count and the
// waiting_for_references badge foreground; green is the brand token.
//
// Tints are spelled out rather than built by appending "1a"/"40" to the
// colour: that hex-alpha trick silently produces invalid CSS for an hsl()
// value, which is how the tracker's decision boxes lost their background.
const TONES: Record<
  ReferenceCompleteness["tone"],
  { fg: string; bg: string; border: string }
> = {
  pending: {
    fg: "hsl(42 95% 65%)",
    bg: "hsl(42 95% 65% / 0.1)",
    border: "hsl(42 95% 65% / 0.28)",
  },
  complete: {
    fg: T.green,
    bg: `${T.green}1a`,
    border: `${T.green}47`,
  },
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

  const tone = TONES[state.tone];

  return (
    <div
      className="rounded-lg p-4 mb-6"
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, color: tone.fg }}>
        {state.title}
      </p>
      <p style={{ fontSize: 12, color: T.textDim, marginTop: 4, lineHeight: 1.5 }}>
        {state.body}
      </p>
    </div>
  );
}
