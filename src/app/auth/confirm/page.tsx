"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthConfirmPage() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function handleConfirm() {
      // --- PKCE flow: ?code=xxx in query string ---
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");
      const errorParam = searchParams.get("error");
      // Recovery (password-reset) links carry ?flow=recovery and/or a
      // type=recovery token — either one routes the user to set a new password
      // instead of onboarding/dashboard.
      const isRecovery = searchParams.get("flow") === "recovery";

      if (errorParam) {
        router.replace("/login?error=invite_expired");
        return;
      }

      // --- OTP token_hash flow in the query string ---
      // Our branded recovery/invite emails link straight here with
      // ?token_hash=…&type=… so that link-scanners pre-fetching the email
      // can't consume the one-time token (only this verifyOtp call does).
      const queryTokenHash = searchParams.get("token_hash");
      const queryType = searchParams.get("type");
      if (queryTokenHash && queryType) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: queryTokenHash,
          type: queryType as any,
        });
        if (error) {
          router.replace("/login?error=invite_expired");
          return;
        }
        router.replace(
          isRecovery || queryType === "recovery"
            ? "/reset-password"
            : "/onboarding"
        );
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace("/login?error=invite_expired");
          return;
        }
        router.replace(isRecovery ? "/reset-password" : "/onboarding");
        return;
      }

      // --- Implicit / hash flow: #access_token=xxx in fragment ---
      const hash = window.location.hash.substring(1);
      if (hash) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");
        const tokenHash = params.get("token_hash");

        // OTP token_hash flow
        if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as any,
          });
          if (error) {
            router.replace("/login?error=invite_expired");
            return;
          }
          router.replace(
            isRecovery || type === "recovery" ? "/reset-password" : "/onboarding"
          );
          return;
        }

        // Access token in hash (implicit flow)
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            router.replace("/login?error=invite_expired");
            return;
          }
          // Recovery → set a new password; invite/signup → onboarding; else dashboard.
          if (isRecovery || type === "recovery") {
            router.replace("/reset-password");
          } else if (type === "invite" || type === "signup") {
            router.replace("/onboarding");
          } else {
            router.replace("/dashboard");
          }
          return;
        }
      }

      // Nothing matched
      router.replace("/login?error=invalid_link");
    }

    handleConfirm();
  }, []);

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "#0D0B09" }}
    >
      <div className="text-center">
        <p
          style={{
            fontSize: "11px",
            letterSpacing: "0.2em",
            color: "hsl(30 8% 42%)",
            textTransform: "uppercase",
          }}
        >
          Verifying…
        </p>
      </div>
    </div>
  );
}
