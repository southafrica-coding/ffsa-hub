import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useTheme } from "@/theme/use-theme";

// ── One yellow band per screen ──────────────────────────────────────────────
// Banner tone="needsYou" registers here; a second one on the same Screen
// warns in development. The rule stops working if it's repeated.

type BandRegistry = { register: (id: symbol) => () => void };

const BandContext = createContext<BandRegistry | null>(null);

/** Called by Banner tone="needsYou" while mounted. */
export function useRegisterNeedsYouBand(active: boolean) {
  const registry = useContext(BandContext);
  useEffect(() => {
    if (!active || !registry) return;
    return registry.register(Symbol("needs-you-band"));
  }, [active, registry]);
}

function createBandRegistry(): BandRegistry {
  const bands = new Set<symbol>();
  return {
    register(id) {
      bands.add(id);
      if (bands.size > 1 && __DEV__) {
        console.warn(`Screen has ${bands.size} yellow "needs you" banners. Use at most one per screen.`);
      }
      return () => {
        bands.delete(id);
      };
    },
  };
}

// ── Screen ──────────────────────────────────────────────────────────────────

export type ScreenProps = {
  children: ReactNode;
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** Lift content above the keyboard (forms). */
  keyboard?: boolean;
  edges?: Edge[];
  contentStyle?: ViewStyle;
};

/** Safe-area page with the theme background and standard padding. */
export function Screen({ children, scroll = true, keyboard = false, edges = ["top", "bottom"], contentStyle }: ScreenProps) {
  const { colors } = useTheme();
  const [registry] = useState(createBandRegistry);
  const padding: ViewStyle = { paddingHorizontal: 20, paddingVertical: 16, gap: 16 };

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[padding, { flexGrow: 1 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[padding, { flex: 1 }, contentStyle]}>{children}</View>
  );

  return (
    <BandContext.Provider value={registry}>
      <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
        {keyboard ? (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </SafeAreaView>
    </BandContext.Provider>
  );
}
