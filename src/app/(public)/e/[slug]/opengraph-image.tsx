import { ImageResponse } from "next/og";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventBySlug } from "@/services/events";
import {
  OG_BRAND,
  ogBrandFromEvent,
  formatEventDateRange,
} from "@/lib/events/og";

// Per-event link-preview card. Next wires this file in as og:image +
// twitter:image for /e/[slug] automatically.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "FFSA Hub event";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The panel's inner content box the logo must fit inside (px).
const LOGO_BOX = { width: 840, height: 236 };

type LoadedLogo = { src: string; width: number; height: number };

// Fetch the event logo and inline it as a PNG data URI sized to fit the panel.
// Logos arrive in mixed formats (webp/png/jpeg/svg) and sizes — and Satori both
// renders some of them blank and ignores `background-size`/`object-fit` — so we
// normalise through sharp to a bounded PNG and return its real dimensions, then
// render an <img> at exactly that size (no cropping, correct aspect ratio).
// Any fetch/decode failure falls back to the brand wordmark.
async function loadLogo(url: string): Promise<LoadedLogo | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(input)
      .resize({ ...LOGO_BOX, fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      src: `data:image/png;base64,${data.toString("base64")}`,
      width: info.width,
      height: info.height,
    };
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();
  const { data: event } = await getEventBySlug(supabase, slug);

  const brand = event ? ogBrandFromEvent(event) : "ff";
  const b = OG_BRAND[brand];
  const title = (event?.title ?? "FFSA Hub").slice(0, 90);
  const dateStr = formatEventDateRange(event?.start_date, event?.end_date);
  const location = event?.location?.trim() ?? "";
  const meta = [dateStr, location.length > 48 ? `${location.slice(0, 48)}…` : location]
    .filter(Boolean)
    .join("   ·   ");
  const logo = event?.logo_url ? await loadLogo(event.logo_url) : null;
  const titleSize = title.length > 34 ? 54 : 68;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: b.bg,
          color: b.text,
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand eyebrow */}
        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 6,
            color: b.accent,
          }}
        >
          {b.label}
        </div>

        {/* Logo panel — off-white so dark wordmarks stay legible on the
            coloured background */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "36px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 940,
              height: 300,
              borderRadius: 28,
              backgroundColor: "#F7F5EF",
            }}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.src} width={logo.width} height={logo.height} alt="" />
            ) : (
              <div
                style={{
                  display: "flex",
                  fontSize: 104,
                  fontWeight: 800,
                  letterSpacing: -2,
                  color: "#14181B",
                }}
              >
                {b.label}
              </div>
            )}
          </div>
        </div>

        {/* Title + date · location */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: titleSize,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -1,
            }}
          >
            {title}
          </div>
          {meta ? (
            <div
              style={{
                display: "flex",
                marginTop: 16,
                fontSize: 30,
                fontWeight: 600,
                color: b.accent,
              }}
            >
              {meta}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { ...size }
  );
}
