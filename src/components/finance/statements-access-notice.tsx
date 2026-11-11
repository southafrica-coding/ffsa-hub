"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const NOTICE = "statements-access";

/**
 * Shown on Finance after Donor Statements sends someone back without
 * donor-statement access. Reads `?notice=statements-access` itself so the
 * finance page only mounts it.
 */
export function StatementsAccessNotice() {
  return (
    <Suspense fallback={null}>
      <StatementsAccessNoticeBody />
    </Suspense>
  );
}

function StatementsAccessNoticeBody() {
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || params.get("notice") !== NOTICE) return null;

  return (
    <div
      role="status"
      className="flex items-start justify-between gap-4 border border-[color:var(--border)] bg-[color:var(--bg-subtle)] px-4 py-3"
    >
      <p className="text-[13px] leading-snug text-[color:var(--text-secondary)]">
        Donor statements need donor-statement access. Ask a finance admin if you need them.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="mono-label shrink-0 text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}
