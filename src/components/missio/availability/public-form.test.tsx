/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPublicView, filledPublicView } from "@/lib/missio/availability/fixtures";
import { AvailabilityStatus, PublicAvailabilityForm } from "./public-form";

vi.mock("next/font/google", () => ({
  Archivo: () => ({ variable: "--font-missio-body", className: "missio-body" }),
  Fraunces: () => ({ variable: "--font-missio-display", className: "missio-display" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

describe("public availability form", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
    document.body.innerHTML = "";
  });

  it("shows an empty choice for each upcoming Sunday and no surname", () => {
    const { host, root } = render(
      <PublicAvailabilityForm token="preview" view={emptyPublicView()} save={async () => {}} />
    );
    roots.push(root);
    hosts.push(host);
    expect(host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("empty");
    expect(host.textContent).toContain("Hi Sam");
    expect(host.textContent).not.toMatch(/Sample|@/);
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.filter((button) => button.textContent === "Available").length).toBeGreaterThanOrEqual(4);
    expect(buttons.every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("keeps a past Sunday read-only and shows the saved choice", () => {
    const { host, root } = render(
      <PublicAvailabilityForm token="preview" view={filledPublicView()} save={async () => {}} />
    );
    roots.push(root);
    hosts.push(host);
    expect(host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("filled");
    const closed = [...host.querySelectorAll("fieldset")].find((field) => field.textContent?.includes("Closed"));
    expect(closed).toBeTruthy();
    const pressed = closed?.querySelector("[aria-pressed='true']");
    expect(pressed?.textContent).toBe("Available");
    expect((pressed as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the tapped Sunday", async () => {
    const saved: string[] = [];
    const { host, root } = render(
      <PublicAvailabilityForm
        token="preview"
        view={emptyPublicView()}
        save={async (input) => {
          saved.push(`${input.serviceDate}:${input.status}`);
        }}
      />
    );
    roots.push(root);
    hosts.push(host);
    const button = host.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(saved[0]).toMatch(/:available$/);
    expect(host.textContent).toContain("Saved for");
  });

  it("shows a friendly expired state with no choices", () => {
    const { host, root } = render(<AvailabilityStatus state="expired" />);
    roots.push(root);
    hosts.push(host);
    expect(host.textContent).toContain("This link has expired");
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).not.toMatch(/Sample|@/);
  });
});
