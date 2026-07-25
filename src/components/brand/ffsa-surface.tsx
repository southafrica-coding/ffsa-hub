import type { CSSProperties, ReactNode } from "react";
import {
  FFSA_BRAND,
  FFSA_COLORS,
  FFSA_CSS_VARS,
  FFSA_FONTS,
  FFSA_GRAPHICS,
  FFSA_LOGOS,
  FFSA_TINTS,
} from "@/lib/brand/ffsa";

// Public-facing FFSA brand chrome — the web counterpart to the email
// shells. Wraps a public surface (today: the 'ff' event storefront) in
// the deck's identity: FFX masthead, black page, yellow accent, Roboto
// Black display type, mono accents, and the FFSA footer lockup.
//
// The deck palette is applied as scoped CSS custom properties, so every
// Card / Button / input inside inherits it while the Hub admin theme
// stays exactly as it is.

/** Masthead: FIRE & FRAGRANCE wordmark over the FFX spray treatment —
 *  yellow repeat-stamps in a grainy blue spray on true black, the deck's
 *  signature graphic (Graphics page). The spray art carries its own
 *  transparency so it sits straight on the black field. */
function FfxMasthead() {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: FFSA_COLORS.BLACK,
        minHeight: 132,
        borderBottom: `2px solid ${FFSA_COLORS.YELLOW}`,
      }}
    >
      {/* The spray band, bled across the full width. Right-anchored so the
          densest FFX stamps sit away from the wordmark. Decorative. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${FFSA_GRAPHICS.FFX_SPRAY})`,
          backgroundSize: "cover",
          backgroundPosition: "right center",
          backgroundRepeat: "no-repeat",
        }}
      />
      {/* Left-side scrim so the wordmark stays legible over the busy art. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(90deg, ${FFSA_COLORS.BLACK} 8%, rgba(0,0,0,0.55) 34%, rgba(0,0,0,0) 62%)`,
        }}
      />
      <div
        style={{
          position: "relative",
          minHeight: 132,
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={FFSA_LOGOS.WORDMARK_WHITE}
          alt={FFSA_BRAND.legalName}
          style={{ height: 22, width: "auto", display: "block" }}
        />
        <span
          style={{
            fontFamily: FFSA_FONTS.MONO,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: FFSA_COLORS.YELLOW,
            whiteSpace: "nowrap",
          }}
        >
          South Africa
        </span>
      </div>
    </div>
  );
}

function FfsaFooter() {
  const line: CSSProperties = {
    fontFamily: FFSA_FONTS.MONO,
    fontSize: 10,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: FFSA_TINTS.TEXT_FAINT,
    margin: "6px 0 0",
  };
  return (
    <footer
      style={{
        marginTop: 28,
        paddingTop: 22,
        borderTop: `1px solid ${FFSA_TINTS.LINE}`,
        textAlign: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={FFSA_LOGOS.WORDMARK_WHITE}
        alt={FFSA_BRAND.legalName}
        style={{ height: 14, width: "auto", margin: "0 auto", display: "block" }}
      />
      <p
        style={{
          ...line,
          marginTop: 12,
          color: FFSA_COLORS.YELLOW,
          letterSpacing: "0.2em",
        }}
      >
        {FFSA_BRAND.slogan.ffsa}
      </p>
      <p style={line}>{FFSA_BRAND.contact.address}</p>
      <p style={line}>
        {FFSA_BRAND.contact.instagram} · {FFSA_BRAND.contact.website}
      </p>
    </footer>
  );
}

export function FFSASurface({ children }: { children: ReactNode }) {
  return (
    <div
      style={
        {
          ...FFSA_CSS_VARS,
          background: FFSA_COLORS.BLACK,
          color: FFSA_COLORS.WHITE,
          fontFamily: FFSA_FONTS.BODY,
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${FFSA_TINTS.LINE}`,
        } as CSSProperties
      }
    >
      <FfxMasthead />
      <div style={{ padding: "20px 16px 24px" }}>
        {children}
        <FfsaFooter />
      </div>
    </div>
  );
}
