/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FFSA_LOGOS } from "@/lib/brand/ffsa";
import { Logo } from "./logo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
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

describe("Logo", () => {
  it("keeps the mark at least 24px tall with clear space of half its height", () => {
    const view = render(<Logo surface="black" height={10} />);
    const img = view.querySelector("img") as HTMLImageElement;
    const frame = view.querySelector("[data-logo]") as HTMLElement;
    expect(img.getAttribute("src")).toBe(FFSA_LOGOS.MARK_WHITE);
    expect(img.style.height).toBe("24px");
    expect(img.style.minHeight).toBe("24px");
    expect(frame.style.padding).toBe("12px");
    expect(frame.style.background).toContain("brand-black");
  });

  it("uses the white wordmark only on black, and the black wordmark only on white", () => {
    const onBlack = render(<Logo surface="black" kind="wordmark" />);
    expect(onBlack.querySelector("img")?.getAttribute("src")).toBe(FFSA_LOGOS.WORDMARK_WHITE);
    act(() => root?.unmount());
    host?.remove();
    const onWhite = render(<Logo surface="white" kind="wordmark" />);
    expect(onWhite.querySelector("img")?.getAttribute("src")).toBe(FFSA_LOGOS.WORDMARK_BLACK);
    expect((onWhite.querySelector("[data-logo]") as HTMLElement).style.background).toContain("--bg");
  });
});
