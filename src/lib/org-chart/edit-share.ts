// The phone directory and the desktop canvas are both mounted (one is
// hidden with CSS). Edit mode has to live in one place, or widening past
// 1280px drops the team you were editing.

import type { DirectoryScreen } from "./phone";

export type OrgEditShare = { edit: boolean; teamId: string | null };

const IDLE: OrgEditShare = { edit: false, teamId: null };

let current: OrgEditShare = IDLE;
const listeners = new Set<(share: OrgEditShare) => void>();

export function readOrgEditShare(): OrgEditShare {
  return current;
}

export function publishOrgEdit(next: OrgEditShare) {
  if (current.edit === next.edit && current.teamId === next.teamId) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function subscribeOrgEdit(listener: (share: OrgEditShare) => void) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) current = IDLE;
  };
}

export function resetOrgEditShare() {
  current = IDLE;
  listeners.clear();
}

/** What the phone directory should show for a shared edit session. */
export function applyDirectoryEdit(screen: DirectoryScreen, share: OrgEditShare): DirectoryScreen {
  if (share.edit && share.teamId) {
    if (screen.edit && screen.screen === "team" && screen.id === share.teamId) return screen;
    return { screen: "team", id: share.teamId, q: screen.q, edit: true, teamId: null };
  }
  if (share.edit) {
    if (screen.edit && screen.screen === "home" && screen.id === "") return screen;
    return { screen: "home", id: "", q: screen.q, edit: true, teamId: null };
  }
  if (!screen.edit) return screen;
  return { ...screen, edit: false, focusId: undefined };
}

/** What the desktop canvas should select for a shared edit session. */
export function applyCanvasEdit(
  canvas: { edit: boolean; sel: string | null },
  share: OrgEditShare
): { edit: boolean; sel: string | null } {
  if (share.edit && share.teamId) {
    const sel = "team:" + share.teamId;
    if (canvas.edit && canvas.sel === sel) return canvas;
    return { edit: true, sel };
  }
  if (share.edit) {
    if (canvas.edit) return canvas;
    return { ...canvas, edit: true };
  }
  if (!canvas.edit) return canvas;
  return { ...canvas, edit: false };
}
