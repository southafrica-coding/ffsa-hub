import { CircleAlert, Eye, EyeOff } from "lucide-react-native";
import { forwardRef, useState, type ComponentRef } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { Pressable } from "./Pressable";

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

/**
 * Label above (13/600), 48pt field, 1px strong-rule outline, 6pt radius.
 * Focus: 2px blue (light) / yellow (dark). Error: 2px danger + icon + message.
 */
export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(function TextField(
  { label, error, hint, secure = false, onFocus, onBlur, editable = true, multiline, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.focus : editable ? colors.ruleStrong : colors.rule;
  const minHeight = multiline ? 88 : touch.minTarget;

  return (
    <View style={{ gap: 6 }}>
      {/* The input carries this label itself, so screen readers don't stop here twice. */}
      <Text
        variant="label"
        nativeID={`${label}-label`}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
      <View
        testID="text-field-box"
        style={{
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          minHeight,
          borderWidth: focused || error ? 2 : hairline,
          borderColor,
          borderRadius: radius.control,
          backgroundColor: editable ? colors.raised : colors.surface,
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
          cursorColor={colors.text}
          allowFontScaling
          editable={editable}
          multiline={multiline}
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
            minHeight: minHeight - 2,
            paddingHorizontal: 12,
            paddingTop: multiline ? 12 : undefined,
            textAlignVertical: multiline ? "top" : "center",
            fontFamily: fontFamily.body,
            fontSize: fontSize.body,
            color: editable ? colors.text : colors.textSecondary,
          }}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            accessibilityHint={revealed ? "Hides the password again." : "Shows the password as plain text."}
            onPress={() => setRevealed((r) => !r)}
            hitSlop={2}
            style={{ width: touch.minTarget, height: touch.minTarget - 2, alignItems: "center", justifyContent: "center" }}
          >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {revealed ? <EyeOff size={20} color={colors.textSecondary} /> : <Eye size={20} color={colors.textSecondary} />}
            </View>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 2 }}>
            <CircleAlert size={14} color={colors.danger} />
          </View>
          <Text
            variant="caption"
            tone="danger"
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={{ flex: 1, fontFamily: fontFamily.bodyMedium }}
          >
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
