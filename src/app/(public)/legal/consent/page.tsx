import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentConsentAgreement, asConsentKind } from "@/services/consent";
import { Markdown } from "@/components/markdown";
import {
  PublicFormShell,
  PublicFormNotice,
  PUBLIC_SHELL_TOKENS,
} from "@/components/public-form-shell";

const T = PUBLIC_SHELL_TOKENS;

export const dynamic = "force-dynamic";

// Eyebrow shown above each policy's title.
const EYEBROW: Record<string, string> = {
  privacy: "Privacy & Data Processing",
  child_protection: "Child Protection",
  nda: "Confidentiality & Non-Disclosure",
};

// Public reader for any policy the Hub collects — `?kind=` selects which
// (defaults to the privacy agreement). Backs every "open to read" link.
export default async function ConsentAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: kindParam } = await searchParams;
  const kind = asConsentKind(kindParam);
  const supabase = createAdminClient();
  const { data: agreement } = await getCurrentConsentAgreement(supabase, kind);

  if (!agreement) {
    return (
      <PublicFormNotice
        eyebrow="Legal"
        heading="Agreement unavailable"
        body="This agreement is currently unavailable. Please contact info@fireandfragrance.com."
      />
    );
  }

  return (
    <PublicFormShell
      eyebrow={EYEBROW[kind] ?? "Legal"}
      heading={agreement.title}
      maxWidth={760}
    >
      <div
        className="prose prose-invert max-w-none"
        style={{ color: T.textDim }}
      >
        <Markdown source={agreement.body_markdown} />
      </div>
      <p
        style={{
          marginTop: 24,
          fontSize: 11,
          color: T.textDimmer,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        Agreement version: {agreement.version}
      </p>
    </PublicFormShell>
  );
}
