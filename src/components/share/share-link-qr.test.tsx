/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import sharp from "sharp";
import jsQR from "jsqr";
import { afterEach, describe, expect, it } from "vitest";
import { ShareLinkQr } from "./share-link-qr";
import { doorShareQrUrl, ticketShareQrUrl } from "./share-qr-png";

const SHARE_URL = "https://www.ffsahub.com/e/send-night-2026";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function decodePng(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return {
    text: code?.data ?? null,
    width: info.width,
    height: info.height,
    corner: [data[0], data[1], data[2], data[3]],
  };
}

function renderQr(props: Partial<ComponentProps<typeof ShareLinkQr>> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <ShareLinkQr
        url={SHARE_URL}
        filename="send-night-2026"
        label="QR code for the public event page"
        {...props}
      />
    );
  });
  return { host, root };
}

describe("ShareLinkQr", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop();
      act(() => root?.unmount());
    }
    while (hosts.length) hosts.pop()?.remove();
  });

  it("encodes the exact share URL and downloads a PNG data URL", async () => {
    const { host, root } = renderQr();
    roots.push(root);
    hosts.push(host);

    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("QR code for the public event page");
    expect(Number(svg?.getAttribute("width"))).toBeGreaterThanOrEqual(160);

    const plate = host.querySelector("[data-qr-plate]") as HTMLElement | null;
    expect(plate?.style.backgroundColor.replace(/\s/g, "")).toMatch(
      /^(#fff|#ffffff|rgb\(255,255,255\))$/i
    );
    expect(plate?.style.filter).toBe("none");

    let xml = svg?.outerHTML ?? "";
    if (!xml.includes("xmlns=")) {
      xml = xml.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
    }
    const shown = await decodePng(await sharp(Buffer.from(xml)).png().toBuffer());
    expect(shown.text).toBe(SHARE_URL);
    expect(shown.corner).toEqual([255, 255, 255, 255]);

    const clicks: { href: string; download: string }[] = [];
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const el = originalCreate(tag, options);
      if (tag.toLowerCase() === "a") {
        const anchor = el as HTMLAnchorElement;
        anchor.click = () => {
          clicks.push({
            href: anchor.getAttribute("href") ?? "",
            download: anchor.download,
          });
        };
      }
      return el;
    }) as typeof document.createElement;

    const download = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Download PNG")
    );
    expect(download).toBeTruthy();
    await act(async () => {
      download?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 20 && clicks.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    document.createElement = originalCreate;

    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe("send-night-2026-qr.png");
    expect(clicks[0].href.startsWith("data:image/png;base64,")).toBe(true);
    const file = await decodePng(Buffer.from(clicks[0].href.split(",")[1], "base64"));
    expect(file.text).toBe(SHARE_URL);
    expect(file.width).toBeGreaterThanOrEqual(512);
    expect(file.height).toBe(file.width);
    expect(file.corner).toEqual([255, 255, 255, 255]);
  });

  it("copies the exact share URL when no copy control is already beside the link", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          written.push(value);
        },
      },
    });
    const { host, root } = renderQr();
    roots.push(root);
    hosts.push(host);

    const copy = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Copy link")
    );
    expect(copy).toBeTruthy();
    await act(async () => {
      copy?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(written).toEqual([SHARE_URL]);
  });

  it("leaves copy to the control already beside the link", () => {
    const { host, root } = renderQr({ showCopy: false });
    roots.push(root);
    hosts.push(host);
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels.some((label) => label?.includes("Copy link"))).toBe(false);
    expect(labels.some((label) => label?.includes("Download PNG"))).toBe(true);
  });

  it("does not encode a relative path and keeps download off until the URL is absolute", () => {
    const { host, root } = renderQr({ url: "/e/send-night-2026" });
    roots.push(root);
    hosts.push(host);

    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("[data-qr-plate]")).toBeNull();
    expect(host.querySelector("[data-qr-placeholder]")?.textContent).toMatch(/full link/i);

    const download = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Download PNG")
    ) as HTMLButtonElement | undefined;
    expect(download).toBeTruthy();
    expect(download?.disabled).toBe(true);

    const clicks: string[] = [];
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const el = originalCreate(tag, options);
      if (tag.toLowerCase() === "a") {
        (el as HTMLAnchorElement).click = () => {
          clicks.push("clicked");
        };
      }
      return el;
    }) as typeof document.createElement;
    download?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.createElement = originalCreate;
    expect(clicks).toEqual([]);
  });

  it("withholds a ticket QR while the public slug is unsaved, empty, or ticketing is off", () => {
    const origin = "https://www.ffsahub.com";
    expect(
      ticketShareQrUrl({
        origin,
        draftSlug: "send-night-draft",
        savedSlug: "send-night-2026",
        ticketingOn: true,
      })
    ).toBeNull();
    expect(
      ticketShareQrUrl({
        origin,
        draftSlug: "  ",
        savedSlug: null,
        ticketingOn: true,
      })
    ).toBeNull();
    expect(
      ticketShareQrUrl({
        origin,
        draftSlug: "",
        savedSlug: "",
        ticketingOn: true,
      })
    ).toBeNull();
    expect(
      ticketShareQrUrl({
        origin,
        draftSlug: "send-night-2026",
        savedSlug: "send-night-2026",
        ticketingOn: false,
      })
    ).toBeNull();
    expect(
      ticketShareQrUrl({
        origin: "",
        draftSlug: "send-night-2026",
        savedSlug: "send-night-2026",
        ticketingOn: true,
      })
    ).toBeNull();
    expect(
      ticketShareQrUrl({
        origin,
        draftSlug: " send-night-2026 ",
        savedSlug: "send-night-2026",
        ticketingOn: true,
      })
    ).toBe(`${origin}/e/send-night-2026`);
  });

  it("withholds a door QR when the link is inactive, revoked, or missing", () => {
    const ready = {
      origin: "https://www.ffsahub.com",
      token: "door-token",
      active: true,
      revoked: false,
    };
    expect(doorShareQrUrl({ ...ready, active: false })).toBeNull();
    expect(doorShareQrUrl({ ...ready, revoked: true })).toBeNull();
    expect(doorShareQrUrl({ ...ready, token: null })).toBeNull();
    expect(doorShareQrUrl({ ...ready, token: "" })).toBeNull();
    expect(doorShareQrUrl({ ...ready, origin: "" })).toBeNull();
    expect(doorShareQrUrl(ready)).toBe("https://www.ffsahub.com/scan/door-token");
  });
});
