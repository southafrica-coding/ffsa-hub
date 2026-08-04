import { FileText, ExternalLink } from "lucide-react";

// One row per policy the user has signed. Pure presentational — the profile
// page fetches the records (RLS: own only) and resolves each agreement title.
export type SignedAgreement = {
  recordId: string;
  title: string;
  version: string;
  acceptedAt: string; // ISO
  source: string; // 'onboarding' | 'application'
};

function fmt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(ms));
}

export function AgreementsCard({ agreements }: { agreements: SignedAgreement[] }) {
  if (agreements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You haven&rsquo;t agreed to any policies yet. Agreements you accept
        during signup or when applying will appear here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {agreements.map((a) => (
        <li
          key={a.recordId}
          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
        >
          <div className="flex min-w-0 items-start gap-3">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium break-words">{a.title}</p>
              <p className="text-xs text-muted-foreground">
                Signed {fmt(a.acceptedAt)} · version{" "}
                <span className="font-mono">{a.version}</span>
              </p>
            </div>
          </div>
          <a
            href={`/print/agreements/${a.recordId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            View / Print
            <ExternalLink className="h-3 w-3" />
          </a>
        </li>
      ))}
    </ul>
  );
}
