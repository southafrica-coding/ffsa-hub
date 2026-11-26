"use client";

import { useEffect, useState } from "react";
import { Flipbook, type FlipPage } from "./flipbook";

// The product page's free preview: the pages Media marked as preview,
// stamped "Preview". Signed links expire, so refetch if one fails.
export function PreviewFlipbook({ slug, fallback }: { slug: string; fallback: React.ReactNode }) {
  const [pages, setPages] = useState<FlipPage[] | null>(null);
  const [total, setTotal] = useState<number | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/store/preview/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((b) => {
        if (!live) return;
        setPages(Array.isArray(b.pages) ? b.pages : []);
        setTotal(b.total || undefined);
      })
      .catch(() => live && setPages([]));
    return () => {
      live = false;
    };
  }, [slug, tick]);

  if (pages === null) return <div className="aspect-[3/4] w-full animate-pulse bg-bone-2 md:aspect-[16/10]" />;
  if (pages.length === 0) return <>{fallback}</>;
  return (
    <Flipbook
      pages={pages}
      total={total}
      onNeedRefresh={() => setTick((t) => t + 1)}
      footer={<span>Preview · {pages.length} of {total ?? pages.length} pages</span>}
    />
  );
}
