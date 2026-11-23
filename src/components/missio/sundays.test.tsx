/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { MissioSundays } from "./sundays";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Missio Sundays tab", () => {
  it("says Planning Center isn't linked, and shows no run sheet", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<MissioSundays />));
    const page = host.querySelector("[data-testid=missio-sundays]") as HTMLElement;
    expect(page.querySelector("h1")?.textContent).toBe("Sundays aren’t linked yet");
    expect(page.textContent).toContain("Sundays will show the Planning Center run sheet here");
    // Nothing made up: no times, team counts or links out.
    expect(page.textContent).not.toMatch(/\d/);
    expect(page.querySelector("a, button")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
