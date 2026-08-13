// Renders a sanitised event description (rich HTML) with element styling
// that inherits the surrounding brand's colour, font and alignment — so it
// reads correctly on every storefront, including the dark ones. The HTML
// passed in is always sanitised upstream (src/lib/events/rich-text.ts), so
// dangerouslySetInnerHTML here is safe.
//
// The brand class (e.g. "wo-hero-desc") is kept on the wrapper so the
// existing colour/size/alignment rules still apply; the arbitrary variants
// below only add the structure the old single-<p> render never needed:
// list bullets, heading weight, paragraph spacing.

const RICH_STYLES = [
  "[&_p]:m-0",
  "[&_p+p]:mt-2",
  "[&_h2]:text-[1.15em] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1",
  "[&_h3]:text-[1.05em] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1 [&_ul]:text-left",
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1 [&_ol]:text-left",
  "[&_li]:mb-0.5",
  "[&_a]:underline [&_a]:underline-offset-2",
  "[&_strong]:font-semibold",
].join(" ");

export function EventDescription({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  if (!html) return null;
  return (
    <div
      className={`${className ?? ""} ${RICH_STYLES}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
