// Missio's public serving, care and feedback links carry Missio's own light
// skin, so they keep that look whichever Light / Dark setting the visitor has
// (see .theme-light in globals.css).
export default function MissioServeLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-light">{children}</div>;
}
