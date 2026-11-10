/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
import { DataTable } from "./department-ui";
import { MoneyCell } from "./money-cell";
import { formatZarFromCents } from "@/lib/format/money";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe("DataTable", () => {
  it("renders the caption, columns and cells", () => {
    const view = render(
      <DataTable
        caption="Budget lines"
        columns={["Line", "Amount"]}
        rows={[["Travel", <MoneyCell key="amt" cents={1_245_000} />]]}
      />
    );

    expect(view.querySelector("caption")?.textContent).toBe("Budget lines");
    expect(view.querySelector("caption")?.className).toContain("sr-only");
    const headers = [...view.querySelectorAll("th")].map((cell) => cell.textContent);
    expect(headers).toEqual(["Line", "Amount"]);
    expect(view.querySelector("td")?.textContent).toBe("Travel");
    expect(view.textContent).toContain(formatZarFromCents(1_245_000));
    expect(view.textContent).toContain("R 12 450,00");
  });
});

describe("MoneyCell", () => {
  it("right-aligns a positive rand amount", () => {
    const view = render(<MoneyCell cents={1_245_000} />);
    const cell = view.querySelector("span");
    expect(cell?.textContent).toBe("R 12 450,00");
    expect(cell?.className).toContain("text-right");
    expect(cell?.className).not.toContain("text-danger");
  });

  it("shows a negative amount in danger colour with a minus sign", () => {
    const view = render(<MoneyCell cents={-1_250} />);
    const cell = view.querySelector("span");
    expect(cell?.textContent).toBe("-R 12,50");
    expect(cell?.className).toContain("text-danger");
  });
});
