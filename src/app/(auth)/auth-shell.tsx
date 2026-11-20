import Image from "next/image";
import { FFSA_TAGLINE } from "@/lib/brand/ffsa";

// The shared chrome for every signed-out screen — sign-in, join, forgot /
// reset password. Login set the pattern (ink poster panel on the left, flat
// form column on the right, no cards); this lifts it out so the rest of the
// auth flow can't drift back into the old dark-card treatment.
const TAGLINE_LINES = FFSA_TAGLINE.split("·").map((part) => part.trim());

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      {/* Left panel — solid ink poster. Hidden below lg so the form never
          falls below the fold on phones. */}
      <div className="relative hidden flex-col justify-between bg-ink p-12 lg:flex lg:w-[46%] xl:w-1/2">
        <Image
          src="/brand/ff-wordmark-white.png"
          alt="Fire & Fragrance"
          width={220}
          height={26}
          style={{ objectFit: "contain" }}
          priority
        />

        <div>
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-[color:var(--text-quiet)]">
            South Africa · Hub
          </div>
          <p className="mt-5 font-display text-[clamp(2.75rem,4.2vw,4.25rem)] font-black uppercase leading-[0.9] tracking-[-0.01em] text-white">
            {TAGLINE_LINES.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* Right column — the content. Flat: no card, no border, no shadow. */}
      <div className="flex w-full flex-col justify-center px-6 py-14 sm:px-10 lg:w-[54%] lg:px-16 xl:w-1/2 xl:px-24">
        <div className="w-full max-w-[440px] animate-fade-up">
          {/* The ink panel is hidden on phones, so the wordmark rides here. */}
          <Image
            src="/brand/ff-wordmark-black.png"
            alt="Fire & Fragrance"
            width={168}
            height={20}
            style={{ objectFit: "contain" }}
            className="mb-10 lg:hidden"
            priority
          />
          {children}
        </div>
      </div>
    </div>
  );
}

/** The long-form error block used across the auth screens — body copy on a
 *  bone block with a red rule, not a one-line field error. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="border-l-2 border-destructive bg-bone px-4 py-3 text-[13px] leading-relaxed text-[color:var(--text-secondary)]"
    >
      {children}
    </p>
  );
}
