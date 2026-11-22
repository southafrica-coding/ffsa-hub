import { savedSchemeScript } from "./no-flash-script";
import { preferenceFromSaved, type ColorScheme } from "./index";

// Rendered at the top of the signed-in shells. Brings this device in line
// with the person's saved setting before the page content below it paints,
// and updates the cookie for next time. Nothing saved (NULL) means "system":
// follow the device, which also undoes a fixed choice this device remembered
// from before the person switched back to System elsewhere.
export function ThemeSync({ scheme }: { scheme: ColorScheme | null }) {
  return <script dangerouslySetInnerHTML={{ __html: savedSchemeScript(preferenceFromSaved(scheme)) }} />;
}
