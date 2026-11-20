import { savedSchemeScript } from "./no-flash-script";
import type { ColorScheme } from "./index";

// Rendered at the top of the signed-in shells. When the person has saved a
// setting, this inline script brings the device in line with it before the
// page content below it paints, and updates the cookie for next time. With
// nothing saved it renders nothing and the device setting stands.
export function ThemeSync({ scheme }: { scheme: ColorScheme | null }) {
  if (!scheme) return null;
  return <script dangerouslySetInnerHTML={{ __html: savedSchemeScript(scheme) }} />;
}
