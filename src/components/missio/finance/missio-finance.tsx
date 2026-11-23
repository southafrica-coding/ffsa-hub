"use client";

import { useCallback, useEffect, useState } from "react";
import { isMissioPastor } from "../access";
import { useMissioViewer } from "../viewer";
import content from "../content.module.css";
import type { MissioFinanceResponse } from "@/lib/missio/finance/server";
import { FinanceNotes, FinanceReport } from "./finance-report";
import { FinanceEntries } from "./finance-entries";
import styles from "./finance.module.css";

export const MISSIO_FINANCE_API = "/api/missio/finance";

type Load =
  | { kind: "loading" }
  | { kind: "error"; status: number }
  | { kind: "ready"; data: MissioFinanceResponse };

async function fetchFinance(): Promise<MissioFinanceResponse> {
  const res = await fetch(MISSIO_FINANCE_API, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error("finance"), { status: res.status });
  return (await res.json()) as MissioFinanceResponse;
}

/**
 * /missio/finance. Pastors only: the shell lets leaders and coaches into
 * Missio, so this page checks again, and the API refuses anyone else anyway.
 */
export function MissioFinance({ load = fetchFinance }: { load?: () => Promise<MissioFinanceResponse> }) {
  const me = useMissioViewer();
  const pastor = me ? isMissioPastor(me) : false;
  const [state, setState] = useState<Load>({ kind: "loading" });

  const refresh = useCallback(() => {
    return load().then(
      (data) => setState({ kind: "ready", data }),
      (error: unknown) => setState({ kind: "error", status: (error as { status?: number }).status ?? 0 })
    );
  }, [load]);

  useEffect(() => {
    if (!pastor) return;
    void refresh();
  }, [pastor, refresh]);

  if (!pastor) {
    return (
      <div className={`${content.page} ${styles.page}`} data-testid="missio-finance-denied">
        <section className={styles.empty}>
          <h1 className={styles.emptyTitle}>Pastors only</h1>
          <p>Missio’s finances are open to the church’s pastors.</p>
        </section>
      </div>
    );
  }

  return (
    <div className={`${content.page} ${styles.page}`} data-testid="missio-finance">
      {state.kind === "loading" ? (
        <div className={content.skeleton} aria-busy="true" aria-label="Loading the income report">
          <span />
          <span />
          <span />
        </div>
      ) : state.kind === "error" ? (
        <section className={styles.empty} role="alert">
          <h1 className={styles.emptyTitle}>{state.status === 403 ? "Pastors only" : "The income report didn’t load"}</h1>
          <p>
            {state.status === 403
              ? "Missio’s finances are open to the church’s pastors."
              : "Nothing was changed. Try again in a moment."}
          </p>
          {state.status !== 403 ? (
            <button type="button" className={styles.primary} onClick={() => void refresh()}>
              Try again
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <FinanceReport data={state.data} />
          <FinanceEntries data={state.data} onSaved={refresh} />
          <FinanceNotes data={state.data} />
        </>
      )}
    </div>
  );
}
