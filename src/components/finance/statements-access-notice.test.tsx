/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatementsAccessNotice } from "./statements-access-notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/finance",
  useRouter: () => ({ replace }),
  useSearchParams: () => search.current,
}));

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  replace.mockClear();
  search.current = new URLSearchParams();
});

function setQuery(query: string) {
  search.current = new URLSearchParams(query);
}

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host;
}

function dismiss(view: HTMLDivElement) {
  const button = view.querySelector("button");
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("StatementsAccessNotice", () => {
  it("says statements need donor-statement access when that notice is present", () => {
    setQuery("notice=statements-access");
    const view = render(<StatementsAccessNotice />);
    expect(view.querySelector("[role='status']")).not.toBeNull();
    expect(view.textContent).toContain(
      "Donor statements need donor-statement access. Ask a finance admin if you need them."
    );
  });

  it("stays quiet for any other notice", () => {
    setQuery("notice=something-else");
    const view = render(<StatementsAccessNotice />);
    expect(view.textContent).toBe("");
  });

  it("dismisses and stays gone", () => {
    setQuery("notice=statements-access");
    const view = render(<StatementsAccessNotice />);
    expect(view.querySelector("button")?.textContent).toBe("Dismiss");
    dismiss(view);
    expect(view.textContent).toBe("");
    expect(replace).toHaveBeenCalledWith("/finance");
  });

  it("drops notice from the url and keeps the other params", () => {
    setQuery("tab=open&notice=statements-access&org=usa");
    const view = render(<StatementsAccessNotice />);
    dismiss(view);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/finance?tab=open&org=usa");
  });
});
