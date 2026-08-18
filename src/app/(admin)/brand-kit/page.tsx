import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { Card, CardContent } from "@/components/ui/card";
import {
  FFSA_BRAND,
  FFSA_COLORS,
  FFSA_FONTS,
  FFSA_GRAPHICS,
  FFSA_LOGOS,
  FFSA_TINTS,
} from "@/lib/brand/ffsa";
import { SwatchGrid } from "./swatch-grid";

export const metadata: Metadata = { title: "Brand Kit" };

// The FFSA brand kit, rendered from src/lib/brand/ffsa.ts — the same
// module the email shells, the campaign brand defaults and the public
// storefront render from. This page is therefore a live view of what the
// product actually sends, not a separate copy of the deck that can rot.

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div>
          <p className="page-eyebrow">{eyebrow}</p>
          <h2
            className="text-lg"
            style={{
              fontFamily: FFSA_FONTS.DISPLAY,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        className="text-[10px] font-bold uppercase tracking-[0.2em] mb-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </p>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-[0.1em]"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--surface-4)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

export default async function BrandKitPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "brand-kit");

  const B = FFSA_BRAND;

  return (
    // Marked .ffsa-screen so it runs edge-to-edge like every other admin
    // route (and so the transition scaffold can be deleted), but the CONTENT
    // is deliberately left in the brand deck's own treatment. This page is a
    // specimen of the FFSA brand — its rounded cover, its own fonts and its
    // own colours are the thing being documented, not a screen that drifted
    // from the redesign. Same standing decision that keeps the five event
    // brand kits out of scope.
    <div className="ffsa-screen">
      <div className="space-y-5 px-5 py-6 md:px-8 md:py-7">
      {/* ── Masthead — the deck's cover, in the brand's own treatment ── */}
      <div
        className="rounded-xl overflow-hidden relative"
        style={{ background: FFSA_COLORS.BLACK, border: `1px solid ${FFSA_TINTS.LINE}` }}
      >
        {/* FFX spray treatment, right-anchored and bled full-height on the
            black field — the deck's Graphics-page artwork. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${FFSA_GRAPHICS.FFX_SPRAY})`,
            backgroundSize: "cover",
            backgroundPosition: "right center",
            backgroundRepeat: "no-repeat",
          }}
        />
        {/* Left scrim so the wordmark + copy stay legible over the art. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, ${FFSA_COLORS.BLACK} 10%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.1) 72%)`,
          }}
        />
        <div className="relative px-6 py-10 sm:px-10 sm:py-14">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={FFSA_LOGOS.WORDMARK_WHITE}
            alt={B.legalName}
            style={{ height: 34, width: "auto", display: "block" }}
          />
          <p
            className="mt-4"
            style={{
              fontFamily: FFSA_FONTS.MONO,
              fontSize: 11,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: FFSA_COLORS.YELLOW,
            }}
          >
            South Africa : Brand Guidelines
          </p>
          <p
            className="mt-3 max-w-xl text-sm leading-relaxed"
            style={{ color: FFSA_TINTS.TEXT_DIM }}
          >
            {B.slogan.ffsa}
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        This is the live brand kit. Every FFSA email, campaign default and
        public event page renders from these exact values — change them in{" "}
        <code className="text-xs">src/lib/brand/ffsa.ts</code> and the whole
        product follows.
      </p>

      {/* ── Colours ── */}
      <Section eyebrow="Fonts & Colours" title="Palette">
        <SwatchGrid />
      </Section>

      {/* ── Typography ── */}
      <Section eyebrow="Fonts & Colours" title="Typography">
        <div className="space-y-5">
          <div>
            <p
              style={{
                fontFamily: FFSA_FONTS.DISPLAY,
                fontWeight: 900,
                fontSize: 30,
                lineHeight: 1.05,
                textTransform: "uppercase",
                letterSpacing: "-0.01em",
              }}
            >
              Headers in Roboto Black
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
              Roboto · weight 900 · uppercase
            </p>
          </div>
          <div>
            <p className="text-sm leading-relaxed" style={{ fontFamily: FFSA_FONTS.BODY }}>
              Roboto for body paragraph. {B.positioning}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
              Roboto · weight 400
            </p>
          </div>
          <div>
            <p
              style={{
                fontFamily: FFSA_FONTS.MONO,
                fontSize: 13,
                letterSpacing: "0.06em",
              }}
            >
              Accent in Mono — eyebrows, labels, data
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
              Space Mono
            </p>
          </div>
          <div>
            <p style={{ fontFamily: FFSA_FONTS.CONDENSED, fontSize: 14 }}>
              Notes set in Condensed — dense secondary copy.
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
              Roboto Condensed
            </p>
          </div>
        </div>
      </Section>

      {/* ── Logos ── */}
      <Section eyebrow="Assets" title="Logos">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { src: FFSA_LOGOS.MARK_WHITE, bg: FFSA_COLORS.BLACK, label: "Mark · white", h: 44 },
            { src: FFSA_LOGOS.MARK_BLACK, bg: FFSA_COLORS.WHITE, label: "Mark · black", h: 44 },
            {
              src: FFSA_LOGOS.WORDMARK_WHITE,
              bg: FFSA_COLORS.BLACK,
              label: "Wordmark · white",
              h: 18,
            },
            {
              src: FFSA_LOGOS.WORDMARK_BLACK,
              bg: FFSA_COLORS.WHITE,
              label: "Wordmark · black",
              h: 18,
            },
          ].map((l) => (
            <div key={l.src}>
              <a
                href={l.src}
                download
                className="block rounded-xl p-5 flex items-center justify-center transition-transform hover:scale-[1.02]"
                style={{ background: l.bg, border: "1px solid var(--surface-4)", minHeight: 96 }}
                title="Download"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.src}
                  alt={l.label}
                  style={{ height: l.h, width: "auto", maxWidth: "100%" }}
                />
              </a>
              <p className="text-[11px] mt-2" style={{ color: "var(--text-secondary)" }}>
                {l.label}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Click to download. White marks go on black or the blue field; black
          marks go on white or bone. Never place the mark on a colour that
          drops contrast below legible.
        </p>
      </Section>

      {/* ── Foundation ── */}
      <Section eyebrow="Brand Deck" title="Brand Foundation">
        <div className="space-y-4">
          <Field label="Slogan · Global" value={B.slogan.global} />
          <Field label="Slogan · FFSA" value={B.slogan.ffsa} />
          <Field label="Positioning" value={B.positioning} />
          <Field label="Vision" value={B.vision} />
          <Field label="Brand Idea" value={B.brandIdea} />
        </div>
      </Section>

      {/* ── Audience ── */}
      <Section eyebrow="Brand Deck" title="Target Audience">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Primary" value={B.audience.primary} />
          <Field label="Type" value={B.audience.type} />
          <Field label="Age" value={B.audience.ageRange} />
          <Field label="Demographic" value={B.audience.demographic} />
          <Field label="Character" value={B.audience.character} />
        </div>
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            We are speaking to
          </p>
          <ul className="space-y-1.5">
            {B.audience.speakingTo.map((s) => (
              <li key={s} className="text-sm flex gap-2">
                <span style={{ color: FFSA_COLORS.YELLOW }}>—</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── Voice ── */}
      <Section eyebrow="Brand Deck" title="Brand Voice and Personality">
        <div className="space-y-4">
          <Field label="The Core Idea" value={`“${B.voice.coreIdea}”`} />
          <Field label="Who is Speaking" value={B.voice.whoIsSpeaking} />
          <Field label="Who We Speak To" value={B.voice.whoWeSpeakTo} />
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              How We Speak
            </p>
            <ul className="space-y-1.5">
              {B.voice.howWeSpeak.map((h) => (
                <li key={h.manner} className="text-sm">
                  <span className="font-semibold">{h.manner}</span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {" "}
                    — “{h.example}”
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              Our Personality
            </p>
            <div className="flex flex-wrap gap-1.5">
              {B.voice.personality.map((p) => (
                <Chip key={p}>{p}</Chip>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Archetype + attributes ── */}
      <Section eyebrow="Brand Deck" title="Archetype & Attributes">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Primary" value={B.archetype.primary} />
          <Field label="Secondary" value={B.archetype.secondary} />
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {B.archetype.statement}
        </p>
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            The impressions we want people to carry
          </p>
          <div className="flex flex-wrap gap-1.5">
            {B.attributes.map((a) => (
              <Chip key={a}>{a}</Chip>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Mentor brands + channels ── */}
      <Section eyebrow="Brand Deck" title="Mentor Brands & Channels">
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            We look to these brands for aesthetic and tone
          </p>
          <ul className="space-y-1.5">
            {B.mentorBrands.map((m) => (
              <li key={m.name} className="text-sm">
                <span className="font-semibold">{m.name}</span>
                <span style={{ color: "var(--text-secondary)" }}> — {m.note}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Primary" value={B.channels.primary.join(" · ")} />
          <Field label="Longform" value={B.channels.longform.join(" · ")} />
        </div>
      </Section>

      {/* ── Contact ── */}
      <Section eyebrow="Brand Deck" title="Contact">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Instagram" value={B.contact.instagram} />
          <Field label="Website" value={B.contact.website} />
          <Field label="Address" value={B.contact.address} />
        </div>
      </Section>
      </div>
    </div>
  );
}
