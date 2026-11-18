import { LargeTitle } from "./LargeTitle";

/**
 * @deprecated Use LargeTitle. Kept so screens not yet migrated (R2/R3) pick
 * up the new header look: `context` is the eyebrow.
 */
export function Masthead({ context, title }: { context: string; title: string }) {
  return <LargeTitle eyebrow={context} title={title} />;
}
