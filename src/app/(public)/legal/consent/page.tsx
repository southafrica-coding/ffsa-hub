import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCurrentConsentAgreement,
  type ConsentKind,
} from "@/services/consent";
import { Markdown } from "@/components/markdown";
import {
  PublicFormShell,
  PublicFormNotice,
  PUBLIC_SHELL_TOKENS,
} from "@/components/public-form-shell";

const T = PUBLIC_SHELL_TOKENS;

export const dynamic = "force-dynamic";

export default async function ConsentAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: kindParam } = await searchParams;
  const kind: ConsentKind = kindParam === "child_data" ? "child_data" : "privacy";
  const isChild = kind === "child_data";

  const supabase = createAdminClient();
  const { data: agreement } = await getCurrentConsentAgreement(supabase, kind);

  if (!agreement) {
    return (
      <PublicFormNotice
        eyebrow={isChild ? "Child Protection" : "Privacy"}
        heading="Agreement unavailable"
        body={`The ${
          isChild ? "child protection policy" : "privacy agreement"
        } is currently unavailable. Please contact info@fireandfragrance.com.`}
      />
    );
  }

  return (
    <PublicFormShell
      eyebrow={isChild ? "Child Protection Policy" : "Privacy & Data Processing"}
      heading={isChild ? "Child Protection Policy & Declaration" : "Consent agreement"}
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
