import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The link-preview card every shared Hub link gets.
//
// Why this exists: a link pasted into WhatsApp or Slack was previewing as
// "FFSA Hub — Fire & Fragrance South Africa — Internal Operations
// Platform" with a cropped wordmark, whatever it actually pointed at. A
// volunteer receiving one had no idea it was a feedback form for the
// event they served at. The card answers "what is this?" before anyone
// taps: a mono eyebrow saying the KIND of thing, the thing's own name,
// and a meta line for the context it belongs to.
//
// Deliberately the Hub's editorial language, not an event brand — same
// reasoning as the feedback form itself. Event storefronts keep their own
// bespoke card at /e/[slug]/opengraph-image.tsx.
//
// Satori cannot see the app's next/font faces (they are woff2, which it
// cannot parse), so the Hub's condensed display face is bundled as a TTF
// alongside the PREACHERS faces and read off disk here. Without it the
// title renders in a thin system sans and the card stops looking like
// the Hub at all. A read failure falls back to system sans rather than
// failing the image.

export const HUB_OG_SIZE = { width: 1200, height: 630 };
export const HUB_OG_CONTENT_TYPE = "image/png";

const BONE = "#F4F2EA";
const INK = "#0A0A0A";
const YELLOW = "#FFB801";
const RULE = "#DEDACE";
const TEXT_DIM = "#45423B";

const FONT_PATH = path.join(
  process.cwd(),
  "public",
  "brand",
  "fonts",
  "RobotoCondensed-Bold.ttf"
);

async function condensedFont(): Promise<Buffer | null> {
  try {
    return await readFile(FONT_PATH);
  } catch {
    return null;
  }
}

export async function hubOgCard({
  eyebrow,
  title,
  meta,
}: {
  /** The KIND of thing this link is — "POST-EVENT FEEDBACK", "FORM". */
  eyebrow: string;
  /** Its own name — the form title, the programme, the event. */
  title: string;
  /** Where it belongs / what it costs the reader — event name, duration. */
  meta?: string | null;
}): Promise<ImageResponse> {
  // Long titles have to drop a size or they wrap to four lines and push
  // the meta line off the card.
  const clean = title.trim() || "FFSA Hub";
  const titleSize = clean.length > 46 ? 62 : clean.length > 28 ? 78 : 94;
  const font = await condensedFont();
  const display = font ? "FFSA Condensed" : "sans-serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BONE,
          padding: 56,
          fontFamily: display,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            background: "#FFFFFF",
            border: `3px solid ${INK}`,
            padding: "56px 60px",
          }}
        >
          {/* Eyebrow — the yellow tick is the card's only accent. */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 44, height: 8, background: YELLOW }} />
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 6,
                textTransform: "uppercase",
                color: TEXT_DIM,
              }}
            >
              {eyebrow}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <div
              style={{
                fontSize: titleSize,
                fontWeight: 800,
                lineHeight: 1.02,
                letterSpacing: -1.5,
                textTransform: "uppercase",
                color: INK,
              }}
            >
              {clean.slice(0, 90)}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              borderTop: `2px solid ${RULE}`,
              paddingTop: 22,
            }}
          >
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: TEXT_DIM,
                maxWidth: 780,
              }}
            >
              {(meta ?? "").slice(0, 80)}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 5,
                color: INK,
              }}
            >
              FFSA HUB
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...HUB_OG_SIZE,
      fonts: font
        ? [{ name: "FFSA Condensed", data: font, weight: 700 as const, style: "normal" as const }]
        : undefined,
    }
  );
}
