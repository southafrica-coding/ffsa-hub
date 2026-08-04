import { Markdown } from "@/components/markdown";
import {
  PublicFormShell,
  PUBLIC_SHELL_TOKENS,
} from "@/components/public-form-shell";
import {
  TICKET_CONSENT_MARKDOWN,
  TICKET_CONSENT_VERSION,
} from "@/lib/ticketing/consent-terms";

const T = PUBLIC_SHELL_TOKENS;

// Full Ticket Purchase Terms & Consent Agreement. Linked from the
// required acceptance checkbox on every event storefront checkout. The
// text is a versioned code constant (src/lib/ticketing/consent-terms.ts)
// so it renders identically to the version recorded on each order.
export const dynamic = "force-static";

export default function TicketTermsPage() {
  return (
    <PublicFormShell
      eyebrow="Ticketing"
      heading="Ticket Purchase Terms & Consent Agreement"
      maxWidth={760}
    >
      <div
        className="prose prose-invert max-w-none"
        style={{ color: T.textDim }}
      >
        <Markdown source={TICKET_CONSENT_MARKDOWN} />
      </div>
      <p
        style={{
          marginTop: 24,
          fontSize: 11,
          color: T.textDimmer,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        Agreement version: {TICKET_CONSENT_VERSION}
      </p>
    </PublicFormShell>
  );
}
