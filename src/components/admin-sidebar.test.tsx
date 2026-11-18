/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSidebar } from "./admin-sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <span role="img" aria-label={props.alt ?? ""} />,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("@/components/missio/org-switcher-mount", () => ({
  OrgSwitcherMount: () => null,
}));

function renderSidebar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<AdminSidebar userRoles={["staff"]} initials="AB" />);
  });
  return { host, root };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function menuButton() {
  return document.body.querySelector("button[aria-label='Open menu']") as HTMLButtonElement | null;
}

function openDrawer(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AdminSidebar mobile menu focus", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
  });

  it("returns focus to the menu button after Escape closes the drawer", async () => {
    const { host, root } = renderSidebar();
    roots.push(root);
    hosts.push(host);

    const button = menuButton();
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-label")).toBe("Open menu");

    openDrawer(button!);
    const dialog = document.body.querySelector("[role='dialog']") as HTMLElement | null;
    expect(dialog).toBeTruthy();
    expect(button?.getAttribute("aria-controls")).toBe(dialog?.id);
    expect(button?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();

    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("returns focus to the menu button after an overlay tap closes the drawer", async () => {
    const { host, root } = renderSidebar();
    roots.push(root);
    hosts.push(host);

    const button = menuButton();
    expect(button).toBeTruthy();
    openDrawer(button!);
    await flush();

    const dialog = document.body.querySelector("[role='dialog']") as HTMLElement | null;
    expect(dialog).toBeTruthy();
    expect(button?.getAttribute("aria-controls")).toBe(dialog?.id);

    const overlay = document.body.querySelector("[data-slot='sheet-overlay']") as HTMLElement | null;
    expect(overlay).toBeTruthy();
    await act(async () => {
      overlay?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 })
      );
    });
    await flush();

    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button?.getAttribute("aria-label")).toBe("Open menu");
  });
});
