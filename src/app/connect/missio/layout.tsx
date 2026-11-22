import "@/components/missio/missio-theme.css";
import { MissioThemeFromUrl } from "@/components/missio/theme";

// The Missio connect card carries Missio's own skin (MissioSA Brand Guide):
// paper by default, ink when the device prefers dark or the URL says #dark.
// theme-light keeps the Hub's own dark tokens out (see .theme-light in
// globals.css); Missio's ink ground comes from missio-theme.css instead.
export default function MissioConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-light">
      <MissioThemeFromUrl />
      {children}
    </div>
  );
}
