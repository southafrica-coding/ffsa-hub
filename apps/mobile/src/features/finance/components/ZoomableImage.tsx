import { useState } from "react";
import { Image, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { Button, Text } from "@/components";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

const MIN = 1;
const MAX = 5;
const STEP = 1.5;

export function clampScale(s: number) {
  "worklet";
  return Math.min(MAX, Math.max(MIN, s));
}

/**
 * A receipt, full screen: pinch to zoom, drag to pan when zoomed, double-tap
 * to toggle zoom. Zoom in / out buttons do the same for anyone who can't
 * pinch (and for screen-reader users). No animation when reduce-motion is on.
 */
export function ZoomableImage({ uri, label }: { uri: string; label: string }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const setScale = (next: number) => {
    "worklet";
    const s = clampScale(next);
    scale.value = reduceMotion ? s : withTiming(s, { duration: 150 });
    savedScale.value = s;
    if (s === MIN) {
      tx.value = reduceMotion ? 0 : withTiming(0, { duration: 150 });
      ty.value = reduceMotion ? 0 : withTiming(0, { duration: 150 });
      savedTx.value = 0;
      savedTy.value = 0;
    }
  };

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      scale.value = clampScale(savedScale.value * e.scale);
    },
    onDeactivate: () => {
      "worklet";
      setScale(scale.value);
    },
  });

  const pan = usePanGesture({
    onUpdate: (e) => {
      "worklet";
      if (scale.value <= MIN) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    },
    onDeactivate: () => {
      "worklet";
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      "worklet";
      setScale(savedScale.value > MIN ? MIN : 2.5);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  if (failed) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text accessibilityRole="alert">{strings.viewer.loadFailed}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ flex: 1, overflow: "hidden", backgroundColor: colors.surface }, animated]}>
          <Image
            source={{ uri }}
            accessible
            accessibilityRole="image"
            accessibilityLabel={label}
            accessibilityHint={strings.viewer.hint}
            resizeMode="contain"
            onError={() => setFailed(true)}
            style={{ flex: 1 }}
            testID="receipt-image"
          />
        </Animated.View>
      </GestureDetector>
      <View style={{ flexDirection: "row", gap: 12, padding: 12, justifyContent: "center" }}>
        <Button label={strings.viewer.zoomOut} variant="secondary" onPress={() => setScale(savedScale.value / STEP)} />
        <Button label={strings.viewer.zoomIn} variant="secondary" onPress={() => setScale(savedScale.value * STEP)} />
      </View>
    </GestureHandlerRootView>
  );
}
