import Image from "next/image";

// The Hub's own editorial language, on a public page.
//
// Feedback forms are filled in by the people who WORKED the event — your
// own team — so they wear FFSA Hub branding rather than the event's
// storefront brand. Structurally this is the admin masthead recipe: bone
// surround, white paper column, ink rules, mono context line, condensed
// black title, and the single yellow tick as the only accent.
//
// Deliberately not built on PublicFormShell: that shell is the dark,
// event-branded chrome the ticketing storefronts and CRM capture forms
// share, and it pulls in a whole per-brand token system this page does
// not want. Fields here inherit the Hub's own input styling from
// globals.css, which is the point — it should look like the Hub.
export function HubFormShell({
  context,
  title,
  children,
  footerNote,
}: {
  context: string;
  title: string;
  children: React.ReactNode;
  footerNote?: string | null;
}) {
  return (
    <div className="min-h-screen bg-bone">
      <div className="mx-auto min-h-screen max-w-[680px] border-ink bg-white sm:border-x">
        {/* Wordmark bar — the Hub identifying itself, not the event. */}
        <div className="flex items-center gap-3 border-b border-ink px-5 py-4 sm:px-8">
          <Image
            src="/brand/ff-mark-black.png"
            alt="Fire &amp; Fragrance"
            width={26}
            height={26}
            priority
            style={{ objectFit: "contain", height: 22, width: "auto" }}
          />
          <span className="mono-label">FFSA HUB</span>
        </div>

        <div className="border-b border-ink px-5 pb-5 pt-6 sm:px-8">
          <div className="masthead-context">{context}</div>
          <h1 className="masthead-title">{title}</h1>
        </div>

        <div className="px-5 py-7 sm:px-8">{children}</div>

        <div className="border-t border-rule px-5 py-5 sm:px-8">
          {footerNote && <p className="mono-label">{footerNote}</p>}
          <p className="mono-label mt-1.5 text-[color:var(--text-quiet)]">
            FIRE &amp; FRAGRANCE SOUTH AFRICA · FFSAHUB.COM
          </p>
        </div>
      </div>
    </div>
  );
}

/** Closed / wrong-link notice, in the same chrome. */
export function HubFormNotice({
  context,
  title,
  body,
}: {
  context: string;
  title: string;
  body: string;
}) {
  return (
    <HubFormShell context={context} title={title}>
      <p className="max-w-[46ch] text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
        {body}
      </p>
    </HubFormShell>
  );
}
