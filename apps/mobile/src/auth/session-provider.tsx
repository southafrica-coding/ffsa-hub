import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { supabase } from "@/lib/supabase";

export type SessionState =
  | { status: "loading"; session: null }
  | { status: "signedOut"; session: null }
  | { status: "signedIn"; session: Session };

const SessionContext = createContext<SessionState>({ status: "loading", session: null });

function fromSession(session: Session | null): SessionState {
  return session ? { status: "signedIn", session } : { status: "signedOut", session: null };
}

/**
 * Restores the stored session on launch (status "loading" until then, while
 * the splash screen stays up) and follows sign-in / sign-out / refresh.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading", session: null });

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState(fromSession(data.session));
      })
      .catch(() => {
        if (active) setState(fromSession(null));
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(fromSession(session));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
