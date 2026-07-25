// ============================================================
// FIRE & FRAGRANCE SOUTH AFRICA — canonical brand kit
// ============================================================
// Single source of truth for the FFSA ('ff') brand, transcribed from
// "FFSA Brand Deck" (South Africa : Brand Guidelines). Every FFSA-branded
// surface reads from here so the emails, the storefront, the public form
// pages and the in-Hub brand kit page can never drift apart again.
//
// Sibling brand modules — same shape, same intent:
//   - the-send-shell.ts   (SEND_COLORS)
//   - ffsa-camps-shell.ts (CAMPS_COLORS)
//   - preachers-shell.ts  (PREACHERS_COLORS)
//
// Before this module the FFSA palette lived hardcoded in five places and
// had drifted into three different yellows (#F5C518, #F5C84B, #F5B31A) —
// none of which was the deck's #FFB801. Do not re-introduce a local hex:
// add it here with a documented role, or use an existing token.
// ============================================================

// ── Palette ─────────────────────────────────────────────────
// The six deck colours, verbatim, each with the role it plays in product
// surfaces. Black + white + yellow carry the brand; bone is the warm
// paper tone; green and blue are the deck's expressive secondaries.

export const FFSA_COLORS = {
  /** #000000 — true black. Page surround, mastheads, footers. The deck is
   *  unapologetically black: not a near-black, not a warm charcoal. */
  BLACK: "#000000",
  /** #FFFFFF — pure white. Primary type on black, and the paper surface. */
  WHITE: "#FFFFFF",
  /** #C5C2AE — bone/sand. Warm secondary surface and muted type; the
   *  "vintage film" tone that keeps the black from reading as sterile. */
  BONE: "#C5C2AE",
  /** #FFB801 — brand yellow. THE accent: CTAs, rules, eyebrows, links. */
  YELLOW: "#FFB801",
  /** #4C9F37 — brand green. Success + confirmed states, and an expressive
   *  block colour in graphic treatments. */
  GREEN: "#4C9F37",
  /** #000DE5 — brand blue. Info states and the FFX graphic treatment
   *  (yellow display type over a blue spray field). */
  BLUE: "#000DE5",
} as const;

// Derived tints/shades. Kept here (not inlined at call sites) so the
// relationship to the six source colours stays visible and auditable.
export const FFSA_TINTS = {
  /** Slightly lifted black for cards sitting on the BLACK surround. */
  SURFACE: "#0A0A0A",
  /** Hairline borders on black. */
  LINE: "#1F1F1F",
  /** Muted body copy on black — bone, dimmed. */
  TEXT_DIM: "rgba(197,194,174,0.72)",
  /** Caption / footer copy on black. */
  TEXT_FAINT: "rgba(197,194,174,0.42)",
  /** Yellow, hovered. */
  YELLOW_HOVER: "#FFCB3D",
  /** Yellow at low opacity — active-nav wash, selected rows. */
  YELLOW_WASH: "rgba(255,184,1,0.12)",
  /** Blue spray field behind FFX display type. */
  BLUE_GLOW: "rgba(0,13,229,0.55)",
  /** Warm off-white paper for light-surface cards (email bodies). */
  PAPER: "#FBFAF7",
  /** Body ink on paper surfaces. */
  INK: "#111111",
  /** Error/destructive — not a deck colour; the minimum needed for
   *  destructive UI. Kept distinct from GREEN/BLUE state colours. */
  RED: "#D92D20",
} as const;

/** The same six colours as bare HSL triplets ("H S% L%"), the form the
 *  app's CSS custom properties expect. Lets a public FFSA surface scope
 *  the deck palette over the Hub's default theme without restyling the
 *  admin — see FFSA_CSS_VARS. */
export const FFSA_HSL = {
  BLACK: "0 0% 0%",
  WHITE: "0 0% 100%",
  BONE: "52 17% 73%",
  YELLOW: "43 100% 50%",
  GREEN: "108 49% 42%",
  BLUE: "237 100% 45%",
} as const;

/** shadcn/globals.css variable overrides for an FFSA-branded public
 *  surface. Applied inline on a wrapper element so every Card, Button and
 *  input inside inherits the deck palette; the admin theme is untouched. */
export const FFSA_CSS_VARS: Record<string, string> = {
  "--background": FFSA_HSL.BLACK,
  "--foreground": FFSA_HSL.WHITE,
  "--card": "0 0% 4%",
  "--card-foreground": FFSA_HSL.WHITE,
  "--popover": "0 0% 4%",
  "--popover-foreground": FFSA_HSL.WHITE,
  "--primary": FFSA_HSL.YELLOW,
  "--primary-foreground": FFSA_HSL.BLACK,
  "--secondary": "0 0% 12%",
  "--secondary-foreground": FFSA_HSL.BONE,
  "--muted": "0 0% 10%",
  "--muted-foreground": "52 10% 62%",
  "--accent": "0 0% 12%",
  "--accent-foreground": FFSA_HSL.WHITE,
  "--border": "0 0% 12%",
  "--input": "0 0% 12%",
  "--ring": FFSA_HSL.YELLOW,
};

// ── Typography ──────────────────────────────────────────────
// Deck: "HEADERS IN ROBOTO BLACK" · "Roboto for body paragraph" ·
// "Accent in Mono" · "Notes: Condensed".

export const FFSA_FONTS = {
  /** Headers — Roboto at weight 900, uppercase. */
  DISPLAY: "'Roboto','Helvetica Neue',Arial,sans-serif",
  /** Body paragraphs — Roboto regular. */
  BODY: "'Roboto','Helvetica Neue',Arial,sans-serif",
  /** Accents, eyebrows, labels, data — mono. */
  MONO: "'Space Mono','Roboto Mono','Courier New',Courier,monospace",
  /** Notes / dense secondary copy — condensed. */
  CONDENSED: "'Roboto Condensed','Arial Narrow',Arial,sans-serif",
} as const;

/** Display type is only ever Roboto *Black*, uppercase. */
export const FFSA_DISPLAY_WEIGHT = 900;

/** Google Fonts <link> for email chrome — Apple Mail honours it, Gmail
 *  strips it and falls back to the stacks above. */
export const FFSA_FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Roboto+Condensed:wght@400;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />';

// ── Logos & graphics ────────────────────────────────────────
// Files already shipped in /public/brand. `@email` variants are the
// size-optimised copies used in inbox chrome.

export const FFSA_LOGOS = {
  /** FF monogram, white — for black/dark surfaces. */
  MARK_WHITE: "/brand/ff-mark-white.png",
  /** FF monogram, black — for white/light surfaces. */
  MARK_BLACK: "/brand/ff-mark-black.png",
  /** FIRE & FRAGRANCE wordmark, white — for black/dark surfaces. */
  WORDMARK_WHITE: "/brand/ff-wordmark-white.png",
  /** FIRE & FRAGRANCE wordmark, black — for white/light surfaces. */
  WORDMARK_BLACK: "/brand/ff-wordmark-black.png",
  MARK_WHITE_EMAIL: "/brand/ff-mark-white@email.png",
  MARK_BLACK_EMAIL: "/brand/ff-mark-black@email.png",
  WORDMARK_WHITE_EMAIL: "/brand/ff-wordmark-white@email.png",
  WORDMARK_BLACK_EMAIL: "/brand/ff-wordmark-black@email.png",
} as const;

/** Wordmark aspect ratio (width ÷ height) — derive one dimension from the
 *  other rather than guessing a height. */
export const FFSA_WORDMARK_RATIO = 8.44;

export const FFSA_GRAPHICS = {
  /** FFX repeat-stamp graphic — yellow display type on blue spray. */
  FFX: "/brand/ffx-graphic.png",
  FFX_BLUE: "/brand/ffx-graphic-blue.png",
  FFX_BANNER: "/brand/ffx-banner.png",
} as const;

// ── Verbal identity ─────────────────────────────────────────
// Transcribed from the deck. Spelling is the deck's own (US "-ize").

export const FFSA_BRAND = {
  name: "Fire & Fragrance",
  legalName: "Fire & Fragrance South Africa",
  shortName: "FFSA",
  region: "South Africa",

  slogan: {
    /** Global Fire & Fragrance slogan. */
    global: "To the Ends of the Earth for Love",
    /** The South Africa slogan — use this one on FFSA surfaces. */
    ffsa: "Catalyze our generation. Evangelize the World.",
  },

  positioning:
    "Reach and catalyze South Africa with the gospel so that they, driven by the love of Jesus, transform communities, campuses, churches, and beyond.",

  vision:
    "Catalyze our generation to take action in South Africa so that they may reach the nations with the gospel.",

  brandIdea: "Catalyze a student missions movement in South Africa.",

  audience: {
    primary: "The Young Revivalist",
    type: "GenZ",
    ageRange: "14 – 26",
    demographic: "High School / University / Young Working",
    character: "Diverse South African",
    /** "We are speaking to:" */
    speakingTo: [
      "A catalytic pack leader",
      "A risk taker ready to leap",
      "Someone waiting to give themselves to something bigger",
      "Someone with greatness inside them — who just needs permission",
    ],
  },

  voice: {
    coreIdea: "Friend talking to a friend.",
    whoIsSpeaking: "A confident, casual, conversational friend and leader.",
    whoWeSpeakTo:
      "Someone with greatness inside them — a risk taker, a pack leader, a person ready to give themselves to something worth living for.",
    /** "HOW WE SPEAK" — each with the deck's own example line. */
    howWeSpeak: [
      { manner: "Confidently and clearly", example: "I've got your back." },
      { manner: "Inspirationally", example: "You can do this." },
      {
        manner: "Enthusiastically",
        example: "like you're telling a friend about something great",
      },
      { manner: "Simply", example: "Oh it's easy, just do this…" },
    ],
    personality: [
      "Encouraging",
      "Full of faith",
      "Informative",
      "Confident",
      "Simple yet sharp",
      "Unapologetic about the truth",
      "Friendly",
    ],
  },

  archetype: {
    primary: "The Hero",
    secondary: "The Outlaw",
    statement:
      "The Hero goes first. They inspire through action, not just words. The Outlaw challenges the status quo and gives permission to break the mould. Together they say: We move. We don't ask for permission. Follow us.",
  },

  /** "These are the impressions we want people to carry." */
  attributes: [
    "Missions",
    "Movement",
    "Pioneers",
    "Catalytic",
    "Lifestyle",
    "Gritty",
    "Happy Holiness",
    "Training",
    "Permission",
    "Youthful",
    "Hospitality",
    "Zealous",
    "Presence Centred",
    "Authentic",
  ],

  /** Brands we look to for aesthetic and tone reference. */
  mentorBrands: [
    { name: "New Balance", note: "effortless, heritage, community" },
    {
      name: "We're Not Really Strangers",
      note: "depth in simplicity, emotional directness",
    },
    { name: "Tommy Hilfiger", note: "youthful, clean, aspirational" },
  ],

  channels: {
    primary: ["Instagram", "TikTok"],
    longform: ["YouTube", "Podcast"],
  },

  contact: {
    instagram: "@ff.southafrica",
    instagramUrl: "https://instagram.com/ff.southafrica",
    website: "ffsouthafrica.com",
    websiteUrl: "https://ffsouthafrica.com",
    address: "94 Steve Biko St, Potchefstroom, 2520, South Africa",
  },
} as const;

/** Footer/masthead tagline — the FFSA slogan in the deck's uppercase
 *  treatment. Used across email chrome and public page footers. */
export const FFSA_TAGLINE = "CATALYZE OUR GENERATION · EVANGELIZE THE WORLD";

// ── Shared shell tokens ─────────────────────────────────────
// Same key names as THE_SEND / FFSA_CAMPS / PREACHERS shell token sets so
// `tokensForBrand(brand)` consumers swap without touching call sites.
// FFSA is a DARK brand: black surround, near-black cards, bone/white type.

export const FFSA_SHELL_TOKENS = {
  bg: FFSA_COLORS.BLACK,
  card: FFSA_TINTS.SURFACE,
  cardElev: "#121212",
  border: FFSA_TINTS.LINE,
  borderSoft: "rgba(255,255,255,0.10)",
  text: FFSA_COLORS.WHITE,
  textDim: FFSA_TINTS.TEXT_DIM,
  textDimmer: FFSA_TINTS.TEXT_FAINT,
  textFaint: "rgba(197,194,174,0.24)",
  yellow: FFSA_COLORS.YELLOW,
  yellowHover: FFSA_TINTS.YELLOW_HOVER,
  green: FFSA_COLORS.GREEN,
  red: FFSA_TINTS.RED,
} as const;

/** Colour swatches as presented in the deck, in deck order — drives the
 *  in-Hub brand kit page so it always mirrors the tokens above. */
export const FFSA_SWATCHES: Array<{
  hex: string;
  name: string;
  role: string;
}> = [
  { hex: FFSA_COLORS.BLACK, name: "Black", role: "Page surround, mastheads, footers" },
  { hex: FFSA_COLORS.WHITE, name: "White", role: "Primary type on black; paper surfaces" },
  { hex: FFSA_COLORS.BONE, name: "Bone", role: "Warm secondary surface and muted type" },
  { hex: FFSA_COLORS.YELLOW, name: "Yellow", role: "The accent — CTAs, rules, eyebrows, links" },
  { hex: FFSA_COLORS.GREEN, name: "Green", role: "Success and confirmed states" },
  { hex: FFSA_COLORS.BLUE, name: "Blue", role: "Info states and the FFX graphic treatment" },
];
