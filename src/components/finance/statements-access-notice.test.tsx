/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatementsAccessNotice } from "./statements-access-notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const params = vi.hoisted(() => ({ notice: null as string | null }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "notice" ? params.notice : null),
  }),
}));

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  params.notice = null;
});

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host;
}

describe("StatementsAccessNotice", () => {
  it("says statements need donor-statement access when that notice is present", () => {
    params.notice = "statements-access";
    const view = render(<StatementsAccessNotice />);
    expect(view.textContent).toContain(
      "Donor statements need donor-statement access. Ask a finance admin if you need them."
    );
  });

  it("stays quiet for any other notice", () => {
    params.notice = "something-else";
    const view = render(<StatementsAccessNotice />);
    expect(view.textContent).toBe("");
  });

  it("dismisses and stays gone", () => {
    params.notice = "statements-access";
    const view = render(<StatementsAccessNotice />);
    const button = view.querySelector("button");
    expect(button?.textContent).toBe("Dismiss");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(view.textContent).toBe("");
  });
});
