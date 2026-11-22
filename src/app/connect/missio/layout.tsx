// The Missio connect card carries Missio's own light skin, so it keeps that
// look whichever Light / Dark setting the visitor has (see .theme-light in
// globals.css). Without this, native fields and pickers turn dark.
export default function MissioConnectLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-light">{children}</div>;
}
