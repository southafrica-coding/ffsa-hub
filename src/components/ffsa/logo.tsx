import { FFSA_LOGOS, FFSA_WORDMARK_RATIO } from "@/lib/brand/ffsa";

export type LogoSurface = "black" | "white";
export type LogoKind = "mark" | "wordmark";

/**
 * The one hub logo. Only solid black or solid white — the component paints
 * that ground itself. The mark is at least 24px tall, with clear space of
 * half that height on every side.
 */
export function Logo({
  surface,
  kind = "mark",
  height = 24,
}: {
  surface: LogoSurface;
  kind?: LogoKind;
  height?: number;
}) {
  const markHeight = Math.max(24, height);
  const clear = markHeight / 2;
  const onBlack = surface === "black";
  const src =
    kind === "wordmark"
      ? onBlack
        ? FFSA_LOGOS.WORDMARK_WHITE
        : FFSA_LOGOS.WORDMARK_BLACK
      : onBlack
        ? FFSA_LOGOS.MARK_WHITE
        : FFSA_LOGOS.MARK_BLACK;
  const width = kind === "wordmark" ? Math.round(markHeight * FFSA_WORDMARK_RATIO) : markHeight;

  return (
    <span
      data-logo
      data-surface={surface}
      data-kind={kind}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: onBlack ? "var(--brand-black)" : "var(--bg)",
        padding: clear,
        lineHeight: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Fire & Fragrance"
        width={width}
        height={markHeight}
        style={{ display: "block", height: markHeight, width, minHeight: 24, objectFit: "contain" }}
      />
    </span>
  );
}
