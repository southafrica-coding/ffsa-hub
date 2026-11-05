import { Archivo } from "next/font/google";

// MISSIO display + body face. Archivo is a bold geometric grotesque that
// sits close to the official MISSIŌ wordmark. Loaded here (not in the root
// layout) so only the missio storefront and missio-branded public forms
// pull it in. preload is off because public-form-shell imports this for
// every brand; the face is only *used* on missio surfaces.
export const missioFont = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  preload: false,
});

// Resolved family stack (generated next/font name + metric-matched
// fallback), for inline styles and scoped CSS strings.
export const MISSIO_FONT_FAMILY = `${missioFont.style.fontFamily},'Helvetica Neue',Arial,sans-serif`;

// Default header wordmark — cropped from the official MISSIŌ logo.
// An event's own logo_url always takes precedence over this.
export const MISSIO_WORDMARK_SRC = "/brands/missio/missio-wordmark.png";
export const MISSIO_WORDMARK_ALT = "MISSIŌ";
