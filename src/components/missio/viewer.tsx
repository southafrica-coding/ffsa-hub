"use client";

import { createContext, useContext } from "react";
import type { MissioMe } from "./types-shim";

const ViewerContext = createContext<MissioMe | null>(null);

export function MissioViewerProvider({ me, children }: { me: MissioMe; children: React.ReactNode }) {
  return <ViewerContext.Provider value={me}>{children}</ViewerContext.Provider>;
}

/** The signed-in Missio profile, once the shell has loaded it. */
export function useMissioViewer(): MissioMe | null {
  return useContext(ViewerContext);
}
