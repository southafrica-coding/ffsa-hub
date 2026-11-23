"use client";

import { useEffect } from "react";
import "./missio-tokens.css";

/**
 * Puts data-org="missio" on <html> while a Missio page is open, so the guide's
 * tokens (missio-tokens.css) are in scope for everything, portals included.
 * Removed again on the way out, so FFSA pages never see them.
 */
export function MissioOrgRoot() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-org", "missio");
    return () => root.removeAttribute("data-org");
  }, []);
  return null;
}
