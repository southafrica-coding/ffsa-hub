/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPublicView, filledPublicView } from "@/lib/missio/availability/fixtures";
import { AvailabilityStatus, PublicAvailabilityForm } from "./public-form";

vi.mock("next/font/google", () => ({
  Archivo: () => ({ variable: "--font-missio-body", className: "missio-body" }),
  Fraunces: () => ({ variable: "--font-missio-display", className: "missio-display" }),
  Roboto_Mono: () => ({ variable: "--font-missio-mono", className: "missio-mono" }),
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
    expect(host.textContent).toContain("Hi Sam, can you serve?");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).not.toMatch(/Sample|@/);
    const buttons = [...host.querySelectorAll("fieldset button")];
    expect(buttons.filter((button) => button.textContent === "Yes").length).toBeGreaterThanOrEqual(4);
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
    expect(pressed?.textContent).toBe("Yes");
    expect((pressed as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps taps on the phone until Send, then saves each answered Sunday with its note", async () => {
    const saved: string[] = [];
    const { host, root } = render(
      <PublicAvailabilityForm
        token="preview"
        view={emptyPublicView()}
        save={async (input) => {
          saved.push(`${input.serviceDate}:${input.status}:${input.note}`);
        }}
      />
    );
    roots.push(root);
    hosts.push(host);
    const send = [...host.querySelectorAll("button")].find((b) => b.textContent === "Send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const [yes] = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Yes");
    await act(async () => {
      yes.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(saved).toEqual([]);
    expect(host.textContent).toMatch(/1 of \d+ answered/);
    await act(async () => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/:available:$/);
    expect(host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("sent");
    expect(host.textContent).toContain("Thanks, Sam.");
    expect(host.textContent).toContain("Change my answers");
  });

  it("sends only changed answers and keeps a saved note", async () => {
    const saved: string[] = [];
    const { host, root } = render(
      <PublicAvailabilityForm
        token="preview"
        view={filledPublicView()}
        save={async (input) => {
          saved.push(`${input.serviceDate}:${input.status}:${input.note}`);
        }}
      />
    );
    roots.push(root);
    hosts.push(host);
    const open = [...host.querySelectorAll("fieldset")].filter((field) => !field.disabled);
    const no = [...open[0].querySelectorAll("button")].find((b) => b.textContent === "No") as HTMLButtonElement;
    await act(async () => {
      no.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((b) => b.textContent === "Send") as HTMLButtonElement;
    await act(async () => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/:unavailable:/);
  });

  it("stays on the form and says so when sending fails", async () => {
    const { host, root } = render(
      <PublicAvailabilityForm
        token="preview"
        view={emptyPublicView()}
        save={async () => {
          throw new Error("That didn't send. Try again.");
        }}
      />
    );
    roots.push(root);
    hosts.push(host);
    const [yes] = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Yes");
    await act(async () => {
      yes.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((b) => b.textContent === "Send") as HTMLButtonElement;
    await act(async () => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("[data-state]")?.getAttribute("data-state")).not.toBe("sent");
    expect(host.textContent).toContain("That didn't send");
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
