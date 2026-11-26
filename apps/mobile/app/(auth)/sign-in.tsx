import { ArrowUpRight } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Image, Linking, View, type TextInput } from "react-native";
import { Pressable } from "@/components/Pressable";

import {
  cooldownMessage,
  initialCooldown,
  recordFailure,
  recordSuccess,
  secondsRemaining,
  signInErrorMessage,
  validateSignInForm,
  type CooldownState,
} from "@/auth/sign-in-logic";
import { clearSignOutReason, useSignOutReason } from "@/auth/sign-out-reason";
import { Banner, Button, LargeTitle, Screen, Text, TextField } from "@/components";
import { announce } from "@/lib/a11y";
import { DEACTIVATED_MESSAGE } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { fontFamily, fontSize, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const wordmark = {
  light: require("../../assets/brand/ff-wordmark-black.png"),
  dark: require("../../assets/brand/ff-wordmark-white.png"),
};

export default function SignInScreen() {
  const { scheme, colors } = useTheme();
  const signOutReason = useSignOutReason();
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState<CooldownState>(initialCooldown);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while cooling down, so the countdown stays live.
  const waitSeconds = secondsRemaining(cooldown, now);
  useEffect(() => {
    if (cooldown.cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldown.cooldownUntil]);

  // Screen readers hear the first field that needs fixing (a failed sign-in
  // is a danger Banner, which announces itself).
  useEffect(() => announce(fieldErrors.email ?? fieldErrors.password), [fieldErrors]);

  async function onSubmit() {
    setFormError(null);
    const errors = validateSignInForm(email, password);
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    const current = Date.now();
    setNow(current);
    if (secondsRemaining(cooldown, current) > 0) return;

    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);

    if (error) {
      setCooldown((c) => recordFailure(c, Date.now()));
      setNow(Date.now());
      setFormError(signInErrorMessage(error));
      return;
    }
    // Success: the auth gate in app/_layout.tsx swaps to the signed-in stack.
    setCooldown(recordSuccess());
    clearSignOutReason();
  }

  function openForgotPassword() {
    Linking.openURL(`${getEnv().apiBaseUrl}/forgot-password`).catch(() => {
      setFormError("Couldn't open your browser. Visit ffsahub.com/forgot-password instead.");
    });
  }

  return (
    <Screen keyboard contentStyle={{ paddingTop: 40, paddingBottom: space.xl, gap: space.xl }}>
      <View style={{ gap: space.xl }}>
        <Image
          source={scheme === "dark" ? wordmark.dark : wordmark.light}
          accessibilityRole="image"
          accessibilityLabel="Fire and Fragrance"
          resizeMode="contain"
          style={{ width: 220, height: 26 }}
        />
        {/* LargeTitle carries its own 16 below; the blocks under it sit 24 apart. */}
        <LargeTitle
          hero
          eyebrow="FFSA Hub"
          title="Sign in"
          subtitle="Use the email and password you use for FFSA Hub on the web."
          style={{ marginTop: space.xl, marginBottom: -space.lg }}
        />
      </View>

      {signOutReason === "deactivated" ? (
        <Banner tone="error" title="Account deactivated" testID="banner-deactivated">
          {DEACTIVATED_MESSAGE}
        </Banner>
      ) : signOutReason === "unauthenticated" ? (
        <Banner tone="info" testID="banner-session-ended">
          Your session has ended. Please sign in again.
        </Banner>
      ) : null}

      <View style={{ gap: space.lg }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="username"
          keyboardType="email-address"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!submitting}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          placeholder="Password"
          secure
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          editable={!submitting}
        />

        {/* One form-level message, above Sign in: never under a field, so it can't hint which part was wrong. */}
        {formError ? (
          <Banner tone="error" testID="sign-in-error">
            {formError}
          </Banner>
        ) : null}
        {waitSeconds > 0 ? (
          <Text
            tone="attention"
            accessibilityLiveRegion="polite"
            testID="cooldown"
            style={{ fontSize: fontSize.sectionTitle, lineHeight: 22, fontFamily: fontFamily.bodyMedium }}
          >
            {cooldownMessage(waitSeconds)}
          </Text>
        ) : null}

        <Button label="Sign in" onPress={onSubmit} loading={submitting} disabled={waitSeconds > 0} />

        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Forgot password? Opens the website in your browser"
          onPress={openForgotPassword}
          style={({ pressed }) => ({
            minHeight: touch.minTarget,
            marginTop: -space.sm,
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "flex-start",
            gap: space.xs,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="label" tone="default" style={{ textDecorationLine: "underline" }}>
            Forgot password?
          </Text>
          <ArrowUpRight size={14} color={colors.text} />
        </Pressable>
      </View>
    </Screen>
  );
}
