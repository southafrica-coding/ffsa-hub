/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MissioViewerProvider } from "../viewer";
import type { MissioMe } from "../types-shim";
import { buildIncomeReport } from "@/lib/missio/finance/report";
import type { MissioFinanceResponse } from "@/lib/missio/finance/server";
import { MissioFinance } from "./missio-finance";
import { chartScale } from "./finance-report";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me = (roles: string[]): MissioMe => ({
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: roles as MissioMe["rolesByOrg"]["missio"] },
  currentOrg: "missio",
});

// Made-up figures, in memory only.
function response(over: Partial<MissioFinanceResponse> = {}): MissioFinanceResponse {
  return {
    report: buildIncomeReport({
      fromMonth: "2026-07",
      today: "2026-11-23",
      amounts: [
        { source: "bank", date: "2026-07-10", cents: 1052100 },
        { source: "snapscan", date: "2026-08-10", cents: 875768 },
        { source: "cash", date: "2026-08-01", cents: 190000 },
      ],
    }),
    bank: { state: "ok", message: null, accountLabel: "MISSIO (account 5110)" },
    entries: { state: "ok", message: null, rows: [] },
    ...over,
  };
}

const roots: Root[] = [];

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve());
}

afterEach(() => {
  while (roots.length) act(() => roots.pop()?.unmount());
  document.body.innerHTML = "";
});

describe("MissioFinance", () => {
  it("is pastors only: a leader or coach never loads the report", async () => {
    for (const roles of [["house_church_leader"], ["coach"]]) {
      let loads = 0;
      const host = render(
        <MissioViewerProvider me={me(roles)}>
          <MissioFinance load={async () => { loads += 1; return response(); }} />
        </MissioViewerProvider>
      );
      await settle();
      expect(host.querySelector("[data-testid=missio-finance-denied]")).not.toBeNull();
      expect(loads).toBe(0);
    }
  });

  it("shows the report to a pastor, with — for empty cells", async () => {
    const host = render(
      <MissioViewerProvider me={me(["pastor"])}>
        <MissioFinance load={async () => response()} />
      </MissioViewerProvider>
    );
    await settle();
    expect(host.querySelector("[data-testid=finance-total]")?.textContent).toBe("R21,178.68");
    expect(host.textContent).toContain("Across 5 months, an average of R4,235.74 per month");
    expect(host.textContent).toContain("November is a partial month, to 23 Nov");
    expect(host.querySelector("[data-testid=finance-card-fundraiseup]")?.textContent).toContain("Nothing entered yet");
    const julyRow = [...host.querySelectorAll("tbody tr")][0];
    expect(julyRow.textContent).toContain("—");
    expect(julyRow.textContent).not.toContain("R0.00");
    expect(host.querySelector("[data-testid=finance-bar-2026-08]")?.getAttribute("aria-label")).toBe(
      "August: total R10,657.68. EFT & other none, SnapScan R8,757.68, FundraiseUp none, Cash R1,900.00."
    );
    expect(host.querySelector("[data-testid=finance-avg-normal]")?.textContent).toContain("August to October");
    expect(host.textContent).toContain("How these figures were put together");
  });

  it("is honest when nothing can be read yet", async () => {
    const data = response({
      report: buildIncomeReport({ fromMonth: "2026-07", today: "2026-11-23", amounts: [] }),
      bank: { state: "needs_scope", message: "Finance needs to reconnect Xero with bank read access.", accountLabel: null },
      entries: { state: "not_installed", message: "Cash and FundraiseUp entries aren’t switched on yet.", rows: [] },
    });
    const host = render(
      <MissioViewerProvider me={me(["pastor"])}>
        <MissioFinance load={async () => data} />
      </MissioViewerProvider>
    );
    await settle();
    expect(host.querySelector("[data-testid=finance-empty]")).not.toBeNull();
    expect(host.querySelector("[data-testid=finance-total]")).toBeNull();
    expect(host.querySelector("[data-testid=finance-bank-notice]")?.textContent).toContain("reconnect Xero");
    expect(host.querySelector("[data-testid=finance-entries-off]")).not.toBeNull();
    expect((host.querySelector("[data-testid=finance-entries] button[type=submit]") as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).not.toMatch(/R\d/);
  });
});

describe("chartScale", () => {
  it("rounds the axis up the way the report does", () => {
    expect(chartScale(8362937)).toEqual({ top: 9_000_000, ticks: [0, 3_000_000, 6_000_000, 9_000_000] });
    expect(chartScale(0).top).toBeGreaterThan(0);
  });
});
