/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const LONG_SCHOOL = "North West Leadership Track Sample School With An Extra Long Name";

vi.stubGlobal(
  "fetch",
  vi.fn(async () =>
    Response.json({
      programs: [{ id: "long-school", name: LONG_SCHOOL, code: "LONG" }],
      population: {
        perProgram: [],
        overall: {
          total: 0,
          tiers: { A: 0, B: 0, C: 0, unknown: 0 },
          genders: {},
          nationalities: [],
        },
      },
    })
  )
);

import { StudentsByNationalityCard } from "./students-by-nationality-card";
import { pickerStyle } from "./use-student-demographics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

describe("citizenship school picker", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
  });

  it("keeps a long school name inside the column and skips the zero caption", async () => {
    expect(LONG_SCHOOL.length).toBeGreaterThanOrEqual(60);
    expect(pickerStyle.borderRadius).toBe(0);
    expect(pickerStyle.background).toBe("var(--surface-1)");
    expect(pickerStyle.minWidth).toBe(0);

    const { host, root } = render(<StudentsByNationalityCard />);
    roots.push(root);
    hosts.push(host);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = host.querySelector("select[aria-label='Filter by school']") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.className).toContain("w-full");
    expect(select.className).toContain("max-w-full");
    expect(select.className).toContain("min-w-0");
    expect(select.textContent).toContain(LONG_SCHOOL);
    expect(host.textContent).toContain("No accepted or enrolled students yet.");
    expect(host.textContent).not.toContain("0 accepted or enrolled");
  });
});
