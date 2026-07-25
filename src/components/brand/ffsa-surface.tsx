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

/** Masthead: FIRE & FRAGRANCE wordmark over the FFX blue spray field,
 *  the deck's signature graphic treatment. */
function FfxMasthead() {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: FFSA_COLORS.BLUE,
        borderBottom: `2px solid ${FFSA_COLORS.YELLOW}`,
      }}
    >
      {/* FFX repeat-stamp graphic — the blue/yellow treatment from the
          deck's Graphics page. Decorative only. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${FFSA_GRAPHICS.FFX_BANNER})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.55,
        }}
      />
      <div
        style={{
          position: "relative",
          padding: "22px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={FFSA_LOGOS.WORDMARK_WHITE}
          alt={FFSA_BRAND.legalName}
          style={{ height: 20, width: "auto", display: "block" }}
        />
        <span
          style={{
            fontFamily: FFSA_FONTS.MONO,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: FFSA_COLORS.WHITE,
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
