// Event storefronts carry the event's own brand kit, so they keep their look
// whichever Light / Dark setting the visitor has (see .theme-light in
// globals.css).
export default function EventStorefrontLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-light">{children}</div>;
}
