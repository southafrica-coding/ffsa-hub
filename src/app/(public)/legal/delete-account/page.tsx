import type { Metadata } from "next";

// The link preview says what this page IS and names nobody.
export const metadata: Metadata = {
  title: "Delete your account",
  description: "How to ask Fire & Fragrance South Africa to delete your FFSA Hub account, and what we keep.",
  openGraph: {
    title: "Delete your account",
    description: "How to ask Fire & Fragrance South Africa to delete your FFSA Hub account, and what we keep.",
    type: "website",
  },
};

import Link from "next/link";
import { DELETION_DAYS, RECORDS_WE_KEEP, WHAT_WE_DELETE } from "@/lib/account-deletion/config";
import { PublicFormShell, PUBLIC_SHELL_TOKENS } from "@/components/public-form-shell";
import { DeletionRequestPanel } from "./deletion-request-panel";
import { loadDeletionPage } from "./load";

const T = PUBLIC_SHELL_TOKENS;

export const dynamic = "force-dynamic";

const h2Style = {
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  fontFamily: "ui-monospace, monospace",
  color: T.textDim,
  margin: "24px 0 8px",
} as const;

const pStyle = { fontSize: 15, lineHeight: 1.6, color: T.text, margin: "0 0 12px" } as const;

function List({ items }: { items: readonly string[] }) {
  return (
    <ul style={{ margin: "0 0 12px", paddingLeft: 20, color: T.text, fontSize: 15, lineHeight: 1.6 }}>
      {items.map((i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          {i}
        </li>
      ))}
    </ul>
  );
}

// Public page for Google Play's "delete account" link (and Apple's in-app
// requirement, via the phone app's Me tab). Explains what is deleted and
// what FFSA must keep; signed in, it files or cancels the same request the
// app does (/api/account/deletion-request). Signed out, it says how to sign
// in or who to email.
export default async function DeleteAccountPage() {
  const state = await loadDeletionPage();
  const { contactEmail } = state;

  return (
    <PublicFormShell eyebrow="Your account" heading="Delete your FFSA Hub account" maxWidth={640}>
      <p style={pStyle}>
        You can ask us to delete your FFSA Hub account at any time. A member of our team will finish it
        within {DELETION_DAYS} days and email you when it&apos;s done. Until then your account keeps working.
      </p>

      <h2 style={h2Style}>What we delete</h2>
      <List items={WHAT_WE_DELETE} />

      <h2 style={h2Style}>What we have to keep</h2>
      <p style={pStyle}>Some records are kept because the law requires it:</p>
      <List items={RECORDS_WE_KEEP} />

      <h2 style={h2Style}>Ask for deletion</h2>
      {state.signedIn ? (
        <DeletionRequestPanel initial={state.request} contactEmail={contactEmail} />
      ) : (
        <div data-testid="signed-out">
          <p style={pStyle}>
            <Link href="/login" style={{ color: T.yellow, fontWeight: 700 }}>
              Sign in to FFSA Hub
            </Link>{" "}
            and come back to this page (ffsahub.com/legal/delete-account) to send your request. In the phone app,
            go to Me → Request account deletion.
          </p>
          <p style={pStyle}>
            Can&apos;t sign in? Email{" "}
            <a href={`mailto:${contactEmail}?subject=Please%20delete%20my%20FFSA%20Hub%20account`} style={{ color: T.yellow }}>
              {contactEmail}
            </a>{" "}
            from the email address on your account and ask for it to be deleted.
          </p>
        </div>
      )}
    </PublicFormShell>
  );
}
