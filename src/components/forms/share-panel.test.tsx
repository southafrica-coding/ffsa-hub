/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "../missio/house-churches/test-render";
import { SharePanel } from "./share-panel";
import { ACCESS_MODE_LABELS } from "./describe";

vi.mock("@/components/share/share-link-qr", () => ({ ShareLinkQr: () => null }));

describe("SharePanel wording", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => cleanup(roots, hosts));
  const mount = (node: React.ReactNode) => {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  };

  it("a token form no longer points at per-house links or 'later'", () => {
    const host = mount(<SharePanel url="https://x.test/f/a" formName="A" accessMode="token" isActive />);
    expect(host.textContent).toContain("Opens only from a personal link, not from this address.");
    expect(host.textContent).not.toMatch(/Copy the leader|house page|later/);
  });

  it("a form with its own share story replaces the access line", () => {
    const host = mount(<SharePanel url="https://x.test/f/a" formName="A" accessMode="public" note="Pick a house first." isActive />);
    expect(host.textContent).toContain("Pick a house first.");
    expect(host.textContent).not.toContain("Anyone with this link can fill it in.");
  });

  it("labels stay plain", () => {
    expect(ACCESS_MODE_LABELS).toEqual({ public: "Anyone with the link", logged_in: "Hub login needed", token: "Personal link only" });
  });
});
