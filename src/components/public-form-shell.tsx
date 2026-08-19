import Image from "next/image";
import type { CSSProperties } from "react";
import { FFSA_SHELL_TOKENS, FFSA_TAGLINE } from "@/lib/brand/ffsa";

// Shared visual shell for all public-facing form/landing pages.
// Mirrors the renderEmailShell layout so emails and the linked pages
// feel like one continuous brand surface.
//
// Tokens are deliberately fixed (not Tailwind-driven) so the shell stays
// stable even if global theme variables change.
//
// Brand model: pages that aren't event-tied (preferences, unsubscribe,
// applications, references, scheduling, legal) keep the default 'ff'
// brand. Event-tied surfaces (outcome forms, the storefront) pass the
// event's brand so workflow emails, the form page, and the storefront
// all read as one continuous identity.

export type PublicShellBrand =
  | "ff"
  | "the_send"
  | "ffsa_camps"
  | "preachers"
  | "wild_ones"
  | "missio";

// FFSA ('ff') token set — canonical, from the brand deck. See
// src/lib/brand/ffsa.ts; don't reintroduce local hexes here.
export const PUBLIC_SHELL_TOKENS = FFSA_SHELL_TOKENS;

// THE SEND token set — same shape as PUBLIC_SHELL_TOKENS so consumers
// can swap with a single `brand === 'the_send' ? SEND : PUBLIC` switch
// and use the same key names. Inside-card tokens (text, textDim) target
// the cream paper background; outside-card tokens (textDimmer, textFaint)
// target the dark navy page background.
export const THE_SEND_SHELL_TOKENS = {
  bg: "#0E1A2B",
  card: "#F7F1E8",
  cardElev: "#FFFFFF",
  border: "#1C314C",
  borderSoft: "rgba(28,49,76,0.18)",
  text: "#1C314C",
  textDim: "rgba(28,49,76,0.72)",
  textDimmer: "rgba(247,241,232,0.55)",
  textFaint: "rgba(247,241,232,0.3)",
  yellow: "#FACF50",
  yellowHover: "#FBDA82",
  green: "#FACF50",
  red: "#FA0015",
} as const;

// FFSA CAMPS token set — same shape/key names as the others so consumers
// swap with a single `tokensForBrand(brand)` call. The accent slot
// (`yellow`) carries the brand blue, so every generic `T.yellow` reference
// (buttons, focus rings, progress bar, selected cards) reads as blue.
// Inside-card tokens (text, textDim) target the cream paper; outside-card
// tokens (textDimmer, textFaint) target the deep-ink page surround.
export const FFSA_CAMPS_SHELL_TOKENS = {
  bg: "#14224A", // deep-ink blue page surround
  card: "#F2E8CC", // cream paper card
  cardElev: "#FFFFFF", // elevated card / input fields
  border: "#2F65E8", // bright blue
  borderSoft: "rgba(47,101,232,0.22)",
  text: "#14224A", // ink body text (on cream)
  textDim: "rgba(20,34,74,0.72)",
  textDimmer: "rgba(242,232,204,0.6)",
  textFaint: "rgba(242,232,204,0.32)",
  yellow: "#2F65E8", // accent slot = brand blue
  yellowHover: "#5683EC",
  green: "#2F65E8",
  red: "#D92D20",
} as const;

// PREACHERS SA token set — same shape/key names as the others. Unlike
// SEND + FFSA Camps (light cream cards), PREACHERS is a DARK brand, so it
// rides the same dark card model as F&F but with the navy/bone palette.
// The accent slot (`yellow`) carries aged bone, so buttons / focus rings /
// selected cards read as a bone stamp. Strictly monochrome.
export const PREACHERS_SHELL_TOKENS = {
  bg: "#0F1920", // near-black ink page surround
  card: "#1B2A33", // gunmetal navy card
  cardElev: "#22333D", // slightly lifted navy — input fields / elevated
  border: "#3A4A54", // muted steel line
  borderSoft: "rgba(58,74,84,0.5)",
  text: "#F7F5EF", // off-white body text (on navy)
  textDim: "#C9BFA9", // dimmed bone
  textDimmer: "rgba(237,230,211,0.55)",
  textFaint: "rgba(237,230,211,0.3)",
  yellow: "#EDE6D3", // accent slot = aged bone
  yellowHover: "#F7F5EF",
  green: "#8FBF9F",
  red: "#E0736A",
} as const;

// WILD ONES token set — same shape/key names as the others. A dark
// brand: charcoal paper on a near-black surround, bone type, and one
// ember accent carried in the `yellow` slot so every generic accent
// reference (buttons, focus rings, selected cards) reads as flame.
// Mirrors src/lib/email/wild-ones-shell.ts (WILD_ONES_COLORS).
export const WILD_ONES_SHELL_TOKENS = {
  bg: "#0B0A09", // near-black surround
  card: "#141210", // charcoal paper card
  cardElev: "#1C1916", // lifted charcoal — input fields
  border: "#3A322C", // hairline
  borderSoft: "rgba(245,241,232,0.12)",
  text: "#F5F1E8", // bone
  textDim: "rgba(245,241,232,0.72)",
  textDimmer: "rgba(245,241,232,0.55)",
  textFaint: "rgba(245,241,232,0.3)",
  yellow: "#F26B21", // accent slot = ember
  yellowHover: "#FF8A1E", // gold highlight
  green: "#7FB069",
  red: "#E0736A",
} as const;

// MISSIO token set — same shape/key names as the others. Also dark, but
// warm and quiet: pine paper on a deep-pine surround, cream type, and a
// single clay/terracotta accent in the `yellow` slot. Mirrors
// src/lib/email/missio-shell.ts (MISSIO_COLORS).
export const MISSIO_SHELL_TOKENS = {
  bg: "#16332A", // deep pine surround
  card: "#20463A", // pine paper card
  cardElev: "#265041", // lifted pine — input fields
  border: "#35594B", // hairline
  borderSoft: "rgba(237,228,211,0.14)",
  text: "#EDE4D3", // cream
  textDim: "rgba(237,228,211,0.74)",
  textDimmer: "rgba(237,228,211,0.55)",
  textFaint: "rgba(237,228,211,0.3)",
  yellow: "#C56A3F", // accent slot = clay
  yellowHover: "#D98A5C", // gold highlight
  green: "#8FBF9F",
  red: "#E0736A",
} as const;

export function tokensForBrand(brand: PublicShellBrand) {
  if (brand === "the_send") return THE_SEND_SHELL_TOKENS;
  if (brand === "ffsa_camps") return FFSA_CAMPS_SHELL_TOKENS;
  if (brand === "preachers") return PREACHERS_SHELL_TOKENS;
  if (brand === "wild_ones") return WILD_ONES_SHELL_TOKENS;
  if (brand === "missio") return MISSIO_SHELL_TOKENS;
  return PUBLIC_SHELL_TOKENS;
}

const T = PUBLIC_SHELL_TOKENS;

export function PublicFormShell({
  eyebrow,
  heading,
  subheading,
  children,
  maxWidth = 560,
  footerNote,
  tagline,
  brand = "ff",
}: {
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  children: React.ReactNode;
  maxWidth?: number;
  footerNote?: string | null;
  /** Override or hide the bottom tagline strip. Pass null to remove. */
  tagline?: string | null;
  /** Visual brand. Defaults to 'ff' so non-event-tied surfaces stay unchanged. */
  brand?: PublicShellBrand;
}) {
  const isTheSend = brand === "the_send";
  const isCamps = brand === "ffsa_camps";
  const tk = tokensForBrand(brand);
  // Brand-specific defaults so existing F&F callers keep their tagline,
  // SEND callers get the SEND ticker line, and FFSA Camps gets its slogan
  // out of the box.
  const isPreachers = brand === "preachers";
  const resolvedTagline =
    tagline === undefined
      ? isTheSend
        ? "THE WAR ON INACTION HAS BEGUN"
        : isCamps
          ? "PERMISSION GRANTED"
          : isPreachers
            ? "GO. PREACH."
            : brand === "wild_ones"
              ? "CARRY THE FIRE"
              : brand === "missio"
                ? "SENT ON MISSION"
                : FFSA_TAGLINE
      : tagline;

  // SEND + FFSA Camps use a flat cream card with a thick coloured border
  // and no shadow — matches their bespoke storefront + ticket email. F&F
  // keeps the rounded dark card with a soft shadow.
  const flatCard = isTheSend || isCamps;
  const cardStyle: CSSProperties = flatCard
    ? {
        background: tk.card,
        border: `3px solid ${tk.border}`,
        borderRadius: 0,
      }
    : {
        background: tk.card,
        border: `1px solid ${tk.border}`,
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.4), 0 24px 40px -24px rgba(0,0,0,0.6)",
      };

  // Heading font: SEND uses Arial Black; FFSA Camps uses the heavy italic
  // Aileron stack (falls back to Helvetica/Arial); PREACHERS uses Big
  // Shoulders — each lines up with its email + storefront masthead. The
  // default (F&F / hub) look is the editorial-light Roboto Condensed Black.
  const headingFontFamily = isTheSend
    ? "'Arial Black','Helvetica Neue',Arial,sans-serif"
    : isCamps
      ? "'Aileron','Helvetica Neue',Arial,sans-serif"
      : isPreachers
        ? "'Big Shoulders Display','Anton','Impact','Haettenschweiler','Arial Narrow Bold',sans-serif"
        : brand === "wild_ones"
          ? "'Oswald','Anton','Impact','Arial Narrow Bold',sans-serif"
          : brand === "missio"
            ? "'Fraunces','Georgia','Times New Roman',serif"
            : "var(--font-condensed, 'Arial Narrow', sans-serif)";

  return (
    <div
      className="min-h-screen px-4 py-10 sm:py-12"
      style={{
        background: tk.bg,
        color: tk.text,
        // F&F's card is dark so we tell the browser to render native
        // form chrome in dark mode. SEND + FFSA Camps cards are cream
        // paper, so we explicitly opt into light chrome — otherwise
        // Safari forces dark fill/text on inputs that overrides our white
        // background + dark text styling.
        colorScheme: flatCard ? "light" : "dark",
      }}
    >
      <div className="mx-auto" style={{ maxWidth }}>
        <BrandLockup brand={brand} />

        <div
          className={flatCard ? "overflow-hidden" : "rounded-2xl overflow-hidden"}
          style={cardStyle}
        >
          {/* Top accent rail — F&F: soft gradient gold; SEND: solid gold
              ticker; FFSA Camps: solid blue "PERMISSION GRANTED" ticker.
              Each mirrors that brand's email header. */}
          {isTheSend ? (
            <div
              style={{
                background: tk.yellow,
                borderBottom: `3px solid ${tk.border}`,
                padding: "8px 14px",
                fontFamily: "'Arial Black','Helvetica Neue',Arial,sans-serif",
                fontSize: 13,
                fontWeight: 900,
                color: tk.border,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                lineHeight: 1.2,
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              <span style={{ color: tk.red }}>→</span>
              &nbsp;THE WAR ON INACTION HAS BEGUN&nbsp;
              <span style={{ color: tk.red }}>→</span>
            </div>
          ) : isCamps ? (
            <div
              style={{
                background: tk.yellow,
                padding: "8px 14px",
                fontFamily: "'Aileron','Helvetica Neue',Arial,sans-serif",
                fontStyle: "italic",
                fontSize: 13,
                fontWeight: 900,
                color: tk.card,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                lineHeight: 1.2,
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              PERMISSION GRANTED&nbsp;&nbsp;&#10022;&nbsp;&nbsp;PERMISSION GRANTED
            </div>
          ) : (
            <div
              style={{
                height: 3,
                background: `linear-gradient(90deg, transparent, ${tk.yellow}, transparent)`,
              }}
            />
          )}

          <div className="px-6 sm:px-9 py-9">
            {(eyebrow || heading || subheading) && (
              <div className="mb-7">
                {eyebrow && (
                  <p
                    style={{
                      fontFamily: isTheSend
                        ? "'Courier New',Courier,monospace"
                        : undefined,
                      fontSize: 11,
                      letterSpacing: isTheSend ? "0.2em" : "0.25em",
                      fontWeight: 700,
                      color: isTheSend ? tk.textDimmer : tk.yellow,
                      textTransform: "uppercase",
                      margin: 0,
                    }}
                  >
                    {isTheSend ? `// ${eyebrow}` : eyebrow}
                  </p>
                )}
                {heading && (
                  <h1
                    style={{
                      fontFamily: headingFontFamily,
                      fontSize: "2.25rem",
                      lineHeight: 1.05,
                      letterSpacing: isTheSend
                        ? "0.005em"
                        : isCamps
                          ? "0.01em"
                          : "0.03em",
                      textTransform: isPreachers ? undefined : "uppercase",
                      fontStyle: isCamps ? "italic" : undefined,
                      fontWeight: isTheSend || isPreachers ? undefined : 900,
                      color: tk.text,
                      margin: eyebrow ? "8px 0 0" : 0,
                    }}
                  >
                    {heading}
                  </h1>
                )}
                {subheading && (
                  <p
                    style={{
                      fontSize: 15,
                      color: tk.textDim,
                      lineHeight: 1.6,
                      margin: "12px 0 0",
                    }}
                  >
                    {subheading}
                  </p>
                )}
              </div>
            )}

            {children}
          </div>
        </div>

        <Footer footerNote={footerNote} tagline={resolvedTagline} brand={brand} />
      </div>
    </div>
  );
}

function BrandLockup({ brand }: { brand: PublicShellBrand }) {
  if (brand === "the_send") {
    const tk = THE_SEND_SHELL_TOKENS;
    return (
      <div className="flex flex-col items-center mb-6">
        <p
          style={{
            margin: 0,
            fontFamily: "'Arial Black','Helvetica Neue',Arial,sans-serif",
            fontSize: 28,
            fontWeight: 900,
            color: tk.yellow,
            letterSpacing: "-0.01em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          THE&nbsp;SEND&nbsp;
          <span
            style={{
              fontFamily: "Helvetica,Arial,sans-serif",
              fontSize: 24,
              color: tk.yellow,
            }}
          >
            →
          </span>
        </p>
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: "'Courier New',Courier,monospace",
            fontSize: 10,
            color: tk.textDimmer,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          SOUTH&nbsp;AFRICA / MMXXVI
        </p>
      </div>
    );
  }
  if (brand === "ffsa_camps") {
    const tk = FFSA_CAMPS_SHELL_TOKENS;
    return (
      <div className="flex flex-col items-center mb-6">
        <p
          style={{
            margin: 0,
            fontFamily: "'Aileron','Helvetica Neue',Arial,sans-serif",
            fontStyle: "italic",
            fontSize: 30,
            fontWeight: 900,
            color: tk.card,
            letterSpacing: "-0.01em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          FFSA&nbsp;CAMPS
        </p>
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif",
            fontSize: 10,
            fontWeight: 700,
            color: tk.textDimmer,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          SOUTH&nbsp;AFRICA &middot; MMXXVI
        </p>
      </div>
    );
  }
  if (brand === "preachers") {
    const tk = PREACHERS_SHELL_TOKENS;
    return (
      <div className="flex flex-col items-center mb-6">
        <Image
          src="/brand/preachers-wordmark-bone.png"
          alt="PREACHERS South Africa"
          width={230}
          height={87}
          priority
          style={{ objectFit: "contain", maxWidth: "62%", height: "auto", width: "auto" }}
        />
        <p
          style={{
            margin: "12px 0 0",
            fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif",
            fontSize: 10,
            fontWeight: 700,
            color: tk.textDimmer,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          SOUTH&nbsp;AFRICA
        </p>
      </div>
    );
  }
  if (brand === "wild_ones") {
    const tk = WILD_ONES_SHELL_TOKENS;
    return (
      <div className="flex flex-col items-center mb-6">
        <Image
          src="/brand/wild-ones-wordmark-white.png"
          alt="WILD ONES"
          width={240}
          height={90}
          priority
          style={{ objectFit: "contain", maxWidth: "58%", height: "auto", width: "auto" }}
        />
        <p
          style={{
            margin: "12px 0 0",
            fontFamily: "'Oswald','Anton','Impact','Arial Narrow Bold',sans-serif",
            fontSize: 10,
            fontWeight: 600,
            color: tk.yellow,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
          }}
        >
          CARRY&nbsp;THE&nbsp;FIRE
        </p>
      </div>
    );
  }

  if (brand === "missio") {
    const tk = MISSIO_SHELL_TOKENS;
    // MISSIO has no wordmark asset — the identity IS the serif, set as
    // live text exactly as the storefront and ticket email do it.
    return (
      <div className="flex flex-col items-center mb-6">
        <p
          style={{
            margin: 0,
            fontFamily: "'Fraunces','Georgia','Times New Roman',serif",
            fontSize: 34,
            fontWeight: 700,
            color: tk.text,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          MISSIO
        </p>
        <p
          style={{
            margin: "12px 0 0",
            fontFamily: "Helvetica,Arial,sans-serif",
            fontSize: 10,
            fontWeight: 700,
            color: tk.yellow,
            letterSpacing: "0.26em",
            textTransform: "uppercase",
          }}
        >
          &#10013;&nbsp;&nbsp;SENT&nbsp;ON&nbsp;MISSION
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center mb-6">
      <Image
        src="/brand/ff-wordmark-white.png"
        alt="Fire & Fragrance"
        width={220}
        height={26}
        priority
        style={{
          objectFit: "contain",
          maxWidth: "60%",
          height: "auto",
          width: "auto",
        }}
      />
      <div
        className="flex items-center gap-2 mt-3"
        style={{ color: T.yellow }}
      >
        <span
          style={{
            display: "inline-block",
            width: 18,
            height: 1,
            background: T.yellow,
          }}
        />
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.32em",
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          South Africa &middot; Hub
        </span>
        <span
          style={{
            display: "inline-block",
            width: 18,
            height: 1,
            background: T.yellow,
          }}
        />
      </div>
    </div>
  );
}

function Footer({
  footerNote,
  tagline,
  brand,
}: {
  footerNote?: string | null;
  tagline: string | null;
  brand: PublicShellBrand;
}) {
  const tk = tokensForBrand(brand);
  const isTheSend = brand === "the_send";
  const isCamps = brand === "ffsa_camps";
  const isPreachers = brand === "preachers";
  return (
    <div className="text-center mt-6 mb-2 space-y-2">
      {footerNote && (
        <p
          style={{
            fontSize: 12,
            color: tk.textDimmer,
            margin: 0,
            fontFamily: isTheSend
              ? "'Courier New',Courier,monospace"
              : undefined,
            letterSpacing: isTheSend ? "0.14em" : undefined,
            textTransform: isTheSend ? "uppercase" : undefined,
          }}
        >
          {isTheSend ? `// ${footerNote}` : footerNote}
        </p>
      )}
      {tagline && (
        <p
          style={{
            fontFamily: isTheSend
              ? "'Arial Black','Helvetica Neue',Arial,sans-serif"
              : isCamps
                ? "'Aileron','Helvetica Neue',Arial,sans-serif"
                : isPreachers
                  ? "'Big Shoulders Display','Anton','Impact','Haettenschweiler','Arial Narrow Bold',sans-serif"
                  : undefined,
            fontStyle: isCamps ? "italic" : undefined,
            fontSize: isTheSend || isCamps || isPreachers ? 11 : 10,
            letterSpacing: isTheSend
              ? "0.18em"
              : isCamps
                ? "0.16em"
                : isPreachers
                  ? "0.14em"
                  : "0.25em",
            fontWeight: isTheSend || isCamps || isPreachers ? 900 : 700,
            color: isTheSend
              ? tk.yellow
              : isCamps
                ? tk.card
                : isPreachers
                  ? tk.yellow
                  : tk.textFaint,
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          {tagline}
        </p>
      )}
      <p
        style={{
          fontSize: 11,
          color: tk.textFaint,
          margin: 0,
          fontFamily: isTheSend
            ? "'Courier New',Courier,monospace"
            : undefined,
          letterSpacing: isTheSend ? "0.18em" : undefined,
          textTransform: isTheSend ? "uppercase" : undefined,
        }}
      >
        {isTheSend || isCamps
          ? "Powered by FFSA Hub"
          : "Fire & Fragrance South Africa"}
        {" — "}
        <a
          href="https://www.ffsahub.com"
          style={{ color: tk.textFaint, textDecoration: "none" }}
        >
          ffsahub.com
        </a>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Notice variant — used for invalid-link / closed / expired pages
// ─────────────────────────────────────────────────────────────────

export function PublicFormNotice({
  eyebrow,
  heading,
  body,
  brand = "ff",
}: {
  eyebrow?: string;
  heading: string;
  body: string;
  brand?: PublicShellBrand;
}) {
  const tk = tokensForBrand(brand);
  return (
    <PublicFormShell
      eyebrow={eyebrow}
      heading={heading}
      maxWidth={480}
      brand={brand}
    >
      <p
        style={{
          fontSize: 15,
          color: tk.textDim,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {body}
      </p>
    </PublicFormShell>
  );
}

// ─────────────────────────────────────────────────────────────────
// Input primitives — dark-themed building blocks for form bodies
// ─────────────────────────────────────────────────────────────────

const inputBaseStyle: CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  border: `1px solid ${T.borderSoft}`,
  background: T.cardElev,
  color: T.text,
  fontSize: 15,
  outline: "none",
  transition: "border-color .15s ease, box-shadow .15s ease",
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
};

export const PUBLIC_INPUT_STYLE = inputBaseStyle;

/** Inline <style> block placed once per page that applies the dark input
 * styling to all native inputs/selects/textareas inside `.ffsa-public`.
 * Pass brand='the_send' for the navy/cream/gold variant — both versions
 * scope under the same `.ffsa-public` class so the caller's wrapper
 * doesn't have to change. */
/**
 * Wins the field chrome back from the admin design layer.
 *
 * globals.css styles bare `input` / `textarea` / `select` / `label` /
 * `button` with `!important` inside `@layer components`, and those rules
 * are not scoped to the admin shell — so they land on these public pages
 * too, repainting every field white-on-bone with 9.5px grey labels. On a
 * dark brand card that reads as glare with near-invisible labels.
 *
 * Restating the brand's own values inside `@layer base` takes them back:
 * for `!important` declarations the cascade REVERSES layer order, so the
 * earlier layer wins — and unlayered `!important` loses to both. (Checked
 * in a browser against the live page, not just read off the spec.)
 *
 * Values come from the same tokens the unlayered rules above use, so the
 * two can't drift apart.
 */
function adminChromeReclaim(
  tk: ReturnType<typeof tokensForBrand>,
  variant: "soft" | "flat",
  fonts: {
    body: string;
    label: string;
    /** Restated because globals.css also forces a face, weight, tracking
     *  and casing onto every bare `button`. */
    button: { family: string; style?: string; weight: number; spacing: string };
  }
): string {
  const flat = variant === "flat";
  return `
@layer base {
  .ffsa-public input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]),
  .ffsa-public textarea,
  .ffsa-public select {
    background: ${tk.cardElev} !important;
    border: ${flat ? "2px" : "1px"} solid ${flat ? tk.border : tk.borderSoft} !important;
    border-radius: ${flat ? "0" : "10px"} !important;
    color: ${tk.text} !important;
    font-family: ${fonts.body} !important;
    font-size: 15px !important;
    padding: 11px 14px !important;
  }
  .ffsa-public input::placeholder,
  .ffsa-public textarea::placeholder {
    color: ${tk.textDimmer} !important;
  }
  .ffsa-public label,
  .ffsa-public .ffsa-public-label {
    font-family: ${fonts.label} !important;
    font-size: ${flat ? "11px" : "13px"} !important;
    font-weight: ${flat ? 700 : 600} !important;
    letter-spacing: ${flat ? "0.18em" : "normal"} !important;
    text-transform: ${flat ? "uppercase" : "none"} !important;
    color: ${tk.text} !important;
  }
  .ffsa-public .ffsa-public-btn-primary {
    font-family: ${fonts.button.family} !important;
    font-style: ${fonts.button.style ?? "normal"} !important;
    font-weight: ${fonts.button.weight} !important;
    letter-spacing: ${fonts.button.spacing} !important;
    text-transform: uppercase !important;
  }
  .ffsa-public .ffsa-public-btn-ghost {
    font-family: ${fonts.body} !important;
    font-weight: 400 !important;
    letter-spacing: normal !important;
    text-transform: none !important;
  }
  /*
   * Surfaces, for the same reason as the fields above.
   *
   * These pages also use the admin design system's semantic utilities —
   * bg-card, text-foreground, border — and those read their values from the
   * :root theme, which the redesign (#212) flipped from dark to light. The
   * labels above are forced to the brand's bone text, so a white bg-card left
   * every label white-on-white: an application form with no readable field
   * names. Restating the surface tokens keeps the utilities honest on a dark
   * shell instead of requiring each public page to avoid them.
   */
  .ffsa-public .bg-card { background-color: ${tk.card} !important; }
  .ffsa-public .bg-background { background-color: ${tk.bg} !important; }
  .ffsa-public .text-foreground { color: ${tk.text} !important; }
  .ffsa-public .text-muted-foreground { color: ${tk.textDim} !important; }
  /* --primary and --accent-foreground are both near-black in the light theme,
     which hid the consent agreement link and the phone country-code trigger
     ("🇿🇦 +27") outright. Found by auditing computed contrast across the
     rendered form, not by reading the classes. */
  .ffsa-public .text-primary { color: ${tk.yellow} !important; }
  /*
   * The `[data-slot]` component layer, which no class-based selector can
   * reach — that is why the phone country-code trigger stayed invisible after
   * the utilities above were reclaimed.
   *
   * globals.css paints every shadcn slot with `!important` off the light
   * palette (`--ink`, `--text-secondary`) and is not scoped to the admin
   * shell, so a transparent-background variant on a dark card renders
   * near-black on near-black. Only the see-through variants need reclaiming:
   * `default` and `destructive` set their own background, so they stay
   * self-consistent.
   */
  .ffsa-public [data-slot="button"][data-variant="outline"],
  .ffsa-public [data-slot="button"][data-variant="outline"] *,
  .ffsa-public [data-slot="button"][data-variant="ghost"],
  .ffsa-public [data-slot="button"][data-variant="ghost"] * {
    color: ${tk.text} !important;
  }
  .ffsa-public [data-slot="button"][data-variant="outline"] {
    border-color: ${tk.borderSoft} !important;
  }
  .ffsa-public [data-slot="button"][data-variant="outline"]:hover,
  .ffsa-public [data-slot="button"][data-variant="ghost"]:hover {
    background: ${tk.cardElev} !important;
  }
  .ffsa-public .border,
  .ffsa-public .border-t,
  .ffsa-public .border-b {
    border-color: ${tk.borderSoft} !important;
  }
}
`;
}

export function PublicFormInputStyles({
  brand = "ff",
}: {
  brand?: PublicShellBrand;
}) {
  if (brand === "the_send") {
    const tk = THE_SEND_SHELL_TOKENS;
    // Note: chevron SVG colour is hard-coded to navy so it reads on the
    // white input background. URI-encoded directly.
    const chevronSvg =
      "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%231C314C' stroke-width='2'%3E%3Cpath d='M1 1l5 5 5-5'/%3E%3C/svg%3E";
    const css = `
.ffsa-public input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]),
.ffsa-public textarea,
.ffsa-public select {
  width: 100%;
  padding: 11px 14px;
  border-radius: 0;
  border: 2px solid ${tk.border};
  background: ${tk.cardElev};
  color: ${tk.text};
  font-family: Helvetica,Arial,sans-serif;
  font-size: 15px;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}
.ffsa-public select {
  background-image: url("data:image/svg+xml,${chevronSvg}");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 12px 8px;
  padding-right: 36px;
}
.ffsa-public input:focus, .ffsa-public textarea:focus, .ffsa-public select:focus {
  border-color: ${tk.yellow};
  box-shadow: 0 0 0 3px ${tk.yellow}55;
}
.ffsa-public input::placeholder, .ffsa-public textarea::placeholder {
  color: ${tk.textDim};
}
.ffsa-public label {
  color: ${tk.text};
}
.ffsa-public-btn-primary {
  background: ${tk.border};
  color: ${tk.card};
  font-family: 'Arial Black','Helvetica Neue',Arial,sans-serif;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 13px;
  padding: 14px 30px;
  border-radius: 0;
  border: 2px solid ${tk.border};
  cursor: pointer;
  transition: background .15s ease, color .15s ease, transform .04s ease;
}
.ffsa-public-btn-primary:hover:not(:disabled) {
  background: ${tk.yellow};
  color: ${tk.border};
}
.ffsa-public-btn-primary:active:not(:disabled) {
  transform: translateY(1px);
}
.ffsa-public-btn-primary:disabled {
  background: ${tk.borderSoft};
  color: ${tk.textDim};
  border-color: ${tk.borderSoft};
  cursor: not-allowed;
}
.ffsa-public-btn-ghost {
  background: transparent;
  color: ${tk.text};
  font-family: 'Courier New',Courier,monospace;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 10px 14px;
  border: none;
  cursor: pointer;
  transition: color .15s ease;
}
.ffsa-public-btn-ghost:hover:not(:disabled) {
  color: ${tk.textDimmer};
}
.ffsa-public-card {
  background: ${tk.cardElev};
  border: 2px solid ${tk.border};
  border-radius: 0;
  padding: 14px 16px;
}
.ffsa-public-card.is-selected {
  border-color: ${tk.border};
  background: ${tk.yellow}33;
}
.ffsa-public-error {
  color: ${tk.red};
  font-family: 'Courier New',Courier,monospace;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-top: 6px;
}
.ffsa-public-label {
  display: block;
  font-family: 'Courier New',Courier,monospace;
  font-size: 11px;
  font-weight: 700;
  color: ${tk.text};
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.ffsa-public-label-required::after {
  content: ' *';
  color: ${tk.red};
}
${adminChromeReclaim(tk, "flat", {
  body: "Helvetica,Arial,sans-serif",
  label: "'Courier New',Courier,monospace",
  button: { family: "'Arial Black','Helvetica Neue',Arial,sans-serif", weight: 900, spacing: "0.12em" },
})}
`;
    return <style dangerouslySetInnerHTML={{ __html: css }} />;
  }

  if (brand === "ffsa_camps") {
    const tk = FFSA_CAMPS_SHELL_TOKENS;
    // Chevron stroke hard-coded to brand blue so it reads on the white
    // input background. URI-encoded directly.
    const chevronSvg =
      "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%232F65E8' stroke-width='2'%3E%3Cpath d='M1 1l5 5 5-5'/%3E%3C/svg%3E";
    const css = `
.ffsa-public input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]),
.ffsa-public textarea,
.ffsa-public select {
  width: 100%;
  padding: 11px 14px;
  border-radius: 0;
  border: 2px solid ${tk.border};
  background: ${tk.cardElev};
  color: ${tk.text};
  font-family: Helvetica,Arial,sans-serif;
  font-size: 15px;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}
.ffsa-public select {
  background-image: url("data:image/svg+xml,${chevronSvg}");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 12px 8px;
  padding-right: 36px;
}
.ffsa-public input:focus, .ffsa-public textarea:focus, .ffsa-public select:focus {
  border-color: ${tk.border};
  box-shadow: 0 0 0 3px ${tk.yellow}40;
}
.ffsa-public input::placeholder, .ffsa-public textarea::placeholder {
  color: ${tk.textDim};
}
.ffsa-public label {
  color: ${tk.text};
}
.ffsa-public-btn-primary {
  background: ${tk.border};
  color: ${tk.cardElev};
  font-family: 'Aileron','Helvetica Neue',Arial,sans-serif;
  font-style: italic;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-size: 13px;
  padding: 14px 30px;
  border-radius: 0;
  border: 2px solid ${tk.border};
  cursor: pointer;
  transition: background .15s ease, color .15s ease, transform .04s ease;
}
.ffsa-public-btn-primary:hover:not(:disabled) {
  background: ${tk.card};
  color: ${tk.border};
}
.ffsa-public-btn-primary:active:not(:disabled) {
  transform: translateY(1px);
}
.ffsa-public-btn-primary:disabled {
  background: ${tk.borderSoft};
  color: ${tk.textDim};
  border-color: ${tk.borderSoft};
  cursor: not-allowed;
}
.ffsa-public-btn-ghost {
  background: transparent;
  color: ${tk.text};
  font-family: Helvetica,Arial,sans-serif;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 10px 14px;
  border: none;
  cursor: pointer;
  transition: color .15s ease;
}
.ffsa-public-btn-ghost:hover:not(:disabled) {
  color: ${tk.textDim};
}
.ffsa-public-card {
  background: ${tk.cardElev};
  border: 2px solid ${tk.border};
  border-radius: 0;
  padding: 14px 16px;
}
.ffsa-public-card.is-selected {
  border-color: ${tk.border};
  background: ${tk.yellow}1f;
}
.ffsa-public-error {
  color: ${tk.red};
  font-family: Helvetica,Arial,sans-serif;
  font-size: 12px;
  letter-spacing: 0.04em;
  margin-top: 6px;
}
.ffsa-public-label {
  display: block;
  font-family: Helvetica,Arial,sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: ${tk.text};
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.ffsa-public-label-required::after {
  content: ' *';
  color: ${tk.red};
}
${adminChromeReclaim(tk, "flat", {
  body: "Helvetica,Arial,sans-serif",
  label: "'Courier New',Courier,monospace",
  button: {
    family: "'Aileron','Helvetica Neue',Arial,sans-serif",
    style: "italic",
    weight: 900,
    spacing: "0.1em",
  },
})}
`;
    return <style dangerouslySetInnerHTML={{ __html: css }} />;
  }

  // ff, preachers, wild_ones and missio all ride the dark-card model, so
  // they share this branch and differ only by tokens + display face.
  const tk = tokensForBrand(brand);
  const displayFont =
    brand === "missio"
      ? "'Fraunces','Georgia','Times New Roman',serif"
      : brand === "wild_ones"
        ? "'Oswald','Anton','Impact','Arial Narrow Bold',sans-serif"
        : "'Aileron','Helvetica Neue',Arial,sans-serif";
  // Same Google Fonts import the bespoke storefronts use, so a form and
  // its storefront render in one face. Must lead the stylesheet: @import
  // is only valid before other rules.
  const fontImport =
    brand === "missio"
      ? "@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap');\n"
      : brand === "wild_ones"
        ? "@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap');\n"
        : "";

  const css = `${fontImport}
.ffsa-public input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]),
.ffsa-public textarea,
.ffsa-public select {
  width: 100%;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid ${tk.borderSoft};
  background: ${tk.cardElev};
  color: ${tk.text};
  font-size: 15px;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}
.ffsa-public select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%23B8A898' stroke-width='2'%3E%3Cpath d='M1 1l5 5 5-5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 12px 8px;
  padding-right: 36px;
}
.ffsa-public input:focus, .ffsa-public textarea:focus, .ffsa-public select:focus {
  border-color: ${tk.yellow};
  box-shadow: 0 0 0 3px ${tk.yellow}33;
}
.ffsa-public input::placeholder, .ffsa-public textarea::placeholder {
  color: ${tk.textDimmer};
}
.ffsa-public label {
  color: ${tk.text};
}
.ffsa-public-btn-primary {
  background: ${tk.yellow};
  color: ${tk.bg};
  font-family: ${displayFont};
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-size: 12px;
  padding: 14px 28px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: background .15s ease, transform .04s ease;
}
.ffsa-public-btn-primary:hover:not(:disabled) {
  background: ${tk.yellowHover};
}
.ffsa-public-btn-primary:active:not(:disabled) {
  transform: translateY(1px);
}
.ffsa-public-btn-primary:disabled {
  background: ${tk.borderSoft};
  color: ${tk.textDimmer};
  cursor: not-allowed;
}
.ffsa-public-btn-ghost {
  background: transparent;
  color: ${tk.textDim};
  font-size: 13px;
  padding: 10px 14px;
  border: none;
  cursor: pointer;
  transition: color .15s ease;
}
.ffsa-public-btn-ghost:hover:not(:disabled) {
  color: ${tk.text};
}
.ffsa-public-card {
  background: ${tk.cardElev};
  border: 1px solid ${tk.borderSoft};
  border-radius: 12px;
  padding: 14px 16px;
}
.ffsa-public-card.is-selected {
  border-color: ${tk.yellow};
  background: ${tk.yellow}14;
}
.ffsa-public-error {
  color: ${tk.red};
  font-size: 13px;
  margin-top: 6px;
}
.ffsa-public-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: ${tk.text};
  margin-bottom: 6px;
}
.ffsa-public-label-required::after {
  content: ' *';
  color: ${tk.red};
}
${adminChromeReclaim(tk, "soft", {
  body: "Helvetica,Arial,sans-serif",
  label: "Helvetica,Arial,sans-serif",
  button: { family: displayFont, weight: 700, spacing: "0.1em" },
})}
`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
