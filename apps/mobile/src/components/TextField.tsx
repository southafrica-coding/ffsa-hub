import { Eye, EyeOff } from "lucide-react-native";
import { forwardRef, useState, type ComponentRef } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";

import { fontFamily, fontSize, hairline, radius, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Text } from "./Text";

export type TextFieldProps = Omit<TextInputProps, "secureTextEntry"> & {
  label: string;
  error?: string | null;
  hint?: string;
  /** Password field with a show/hide toggle. */
  secure?: boolean;
};

/** Labelled input with inline error. Hairline border; ink border on focus. */
export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(function TextField(
  { label, error, hint, secure = false, onFocus, onBlur, editable = true, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.text : colors.ruleStrong;

  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="secondary" nativeID={`${label}-label`}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: touch.minTarget,
          borderWidth: focused || error ? 2 : hairline,
          borderColor,
          borderRadius: radius.default,
          backgroundColor: editable ? colors.bg : colors.surface,
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${label}-label`}
          accessibilityHint={error ?? hint}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor={colors.textQuiet}
          selectionColor={colors.text}
          allowFontScaling
          editable={editable}
          secureTextEntry={secure && !revealed}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
          style={{
            flex: 1,
            minHeight: touch.minTarget - 2,
            paddingHorizontal: 12,
            fontFamily: fontFamily.body,
            fontSize: fontSize.body,
            color: colors.text,
          }}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            onPress={() => setRevealed((r) => !r)}
            style={{ width: touch.minTarget, height: touch.minTarget, alignItems: "center", justifyContent: "center" }}
          >
            {revealed ? <EyeOff size={20} color={colors.textSecondary} /> : <Eye size={20} color={colors.textSecondary} />}
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
