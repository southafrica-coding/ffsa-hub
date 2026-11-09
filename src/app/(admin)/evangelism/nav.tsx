import Link from "next/link";

const LINKS = [
  { href: "/evangelism", key: "upload", label: "Upload" },
  { href: "/evangelism/queue", key: "queue", label: "Publish queue" },
  { href: "/evangelism/screen", key: "screen", label: "TV screen" },
] as const;

export function EvangelismNav({ current }: { current: (typeof LINKS)[number]["key"] }) {
  return (
    <>
      {LINKS.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className="chip hover:border-ink hover:text-ink"
          data-active={link.key === current ? "true" : undefined}
          aria-current={link.key === current ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
