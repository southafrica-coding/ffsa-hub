/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));

import { Workshops, type Provider } from "./workshops";
import { providerBody, siteHref, siteLabel, telHref } from "./provider-fields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const motech: Provider = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Motech Sunninghill",
  services: "Services, repairs",
  phone: "011 234 5678",
  phone2: "+27 82 000 1111",
  email: "service@example.com",
  website: "example.co.za",
  address: "1 Main Road",
  hours: "Mon–Fri 7:30–17:00",
  notes: "Ask for Sipho",
};

let host: HTMLDivElement, root: Root | null = null;
function render(providers: Provider[], canManage: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Workshops providers={providers} canManage={canManage} />));
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.restoreAllMocks();
  refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("provider fields", () => {
  it("makes tap-to-call and website links as the app does", () => {
    expect(telHref("+27 (82) 000-1111")).toBe("tel:+27820001111");
    expect(siteHref("example.co.za")).toBe("https://example.co.za");
    expect(siteHref("http://x.org")).toBe("http://x.org");
    expect(siteHref("javascript:alert(1)")).toBe("https://javascript:alert(1)");
    expect(siteLabel("https://example.co.za")).toBe("example.co.za");
    expect(providerBody({ name: "  A ", phone: undefined })).toEqual({
      name: "A", services: "", phone: "", phone2: "", email: "", website: "", address: "", hours: "", notes: "",
    });
  });
});

describe("Workshops", () => {
  it("lists a workshop with phone, email, website, address, hours and notes", () => {
    render([motech], false);
    expect(host.textContent).toContain("Workshops & providers");
    expect(host.textContent).toContain("Where the vehicles go for services, repairs and inspections a non-mechanic can’t do.");
    const tels = [...host.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute("href"));
    expect(tels).toEqual(["tel:0112345678", "tel:+27820001111"]);
    expect(host.querySelector('a[href="mailto:service@example.com"]')).toBeTruthy();
    const site = host.querySelector('a[href="https://example.co.za"]')!;
    expect(site.getAttribute("target")).toBe("_blank");
    for (const t of ["Other phone", "1 Main Road", "Mon–Fri 7:30–17:00", "Ask for Sipho", "Services, repairs"]) expect(host.textContent).toContain(t);
    // Viewers can't add or edit.
    expect(button("Add provider")).toBeUndefined();
    expect(button("Edit")).toBeUndefined();
  });

  it("says when there are none", () => {
    render([], true);
    expect(host.textContent).toContain("No providers yet.");
    expect(button("Add provider")).toBeTruthy();
  });

  it("edits a workshop with PUT and refreshes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render([motech], true);
    act(() => button("Edit")!.click());
    expect(document.body.textContent).toContain("Edit Motech Sunninghill");
    const inputs = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')];
    expect(inputs[0].value).toBe("Motech Sunninghill");
    await act(async () => button("Save")!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/vehicles/fleet/providers/${motech.id}`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ name: "Motech Sunninghill", phone: "011 234 5678", notes: "Ask for Sipho" });
    expect(toast.success).toHaveBeenCalledWith("Provider saved.");
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("asks for a name before adding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render([], true);
    act(() => button("Add provider")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Add provider");
    await act(async () => button("Save")!.click());
    expect(toast.error).toHaveBeenCalledWith("Enter the provider’s name.");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
