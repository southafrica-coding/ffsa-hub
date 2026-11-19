import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Camera, Flashlight, FlashlightOff, X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, Linking, ScrollView, View } from "react-native";
import { Pressable } from "@/components/Pressable";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Text } from "@/components";
import { hairline, palette, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";
import { Heading } from "./ListHeader";

type Props = {
  /** Raw QR contents. Debouncing happens in the door controller. */
  onScanned: (data: string) => void;
  /** Stop reading codes (a result is on screen, or one is being sent). */
  paused: boolean;
  onClose: () => void;
  /** "Type the code instead" from the permission screens. */
  onTypeCode: () => void;
  /** Shown over the bottom of the viewfinder (the verdict). */
  overlay?: ReactNode;
};

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: touch.minTarget,
        height: touch.minTarget,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.control,
        backgroundColor: pressed ? palette.textSecondary : palette.ink,
      })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </Pressable>
  );
}

/**
 * Full-screen QR scanner. Asks for the camera just in time, explains why
 * first, and if it has been refused offers Settings plus the ways to check
 * someone in without a camera. QR codes only.
 *
 * Over the camera there is only Close, the torch, the yellow corner
 * brackets and the result. That chrome is ink/white regardless of theme: it
 * sits over a live picture, so it needs the strongest contrast available.
 */
export function ScannerView({ onScanned, paused, onClose, onTypeCode, overlay }: Props) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [mountError, setMountError] = useState(false);

  // The camera is a state of the door screen, not a route of its own: without
  // this, Android's back button would leave the door instead of closing it.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const handle = (r: BarcodeScanningResult) => {
    if (r.data) onScanned(r.data);
  };

  if (!permission) {
    return (
      <View
        testID="scanner-loading"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={strings.a11y.scannerStarting}
        style={{ flex: 1, backgroundColor: colors.bg }}
      />
    );
  }

  if (!permission.granted) {
    const denied = !permission.canAskAgain;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={denied ? "camera-denied" : "camera-rationale"}>
        {/* Scrolls: at the largest text sizes the buttons would fall off a small phone. */}
        <ScrollView contentContainerStyle={{ paddingVertical: space.xl, paddingHorizontal: space.gutter, gap: space.md }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.card,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface,
              borderWidth: hairline,
              borderColor: colors.rule,
            }}
          >
            <Camera size={24} color={colors.text} />
          </View>
          <Heading>{denied ? strings.camera.deniedTitle : strings.camera.rationaleTitle}</Heading>
          <Text tone="secondary">{denied ? strings.camera.deniedBody : strings.camera.rationaleBody}</Text>
          {denied ? (
            <Button label={strings.camera.openSettings} onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label={strings.camera.allow} onPress={() => void requestPermission()} />
          )}
          <Button label={strings.checkIn.typeCode} variant="secondary" onPress={onTypeCode} />
          <Button label={strings.camera.close} variant="text" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.ink }} testID="scanner">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={paused ? undefined : handle}
        onMountError={() => setMountError(true)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={strings.a11y.camera}
        accessibilityIgnoresInvertColors
      />
      <SafeAreaView style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.sm, paddingTop: space.sm }} pointerEvents="box-none">
          <IconButton label={strings.camera.close} onPress={onClose}>
            <X size={28} color={palette.white} />
          </IconButton>
          <IconButton label={torch ? strings.camera.torchOff : strings.camera.torchOn} onPress={() => setTorch((t) => !t)}>
            {torch ? <FlashlightOff size={24} color={palette.white} /> : <Flashlight size={24} color={palette.white} />}
          </IconButton>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
          <Reticle />
        </View>
        <View style={{ padding: space.lg, gap: space.md }} pointerEvents="box-none">
          {overlay ?? (
            <View
              accessibilityLiveRegion={mountError ? "assertive" : "none"}
              accessibilityRole={mountError ? "alert" : undefined}
              style={{ backgroundColor: palette.ink, padding: space.lg, borderWidth: 2, borderColor: palette.white, borderRadius: radius.card }}
            >
              <Text style={{ color: palette.white }}>{mountError ? strings.camera.mountError : strings.camera.aim}</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const CORNER = 44;
const STROKE = 4;

/** Four yellow corner brackets: where to hold the QR. Decoration only. */
function Reticle() {
  const corner = { position: "absolute" as const, width: CORNER, height: CORNER, borderColor: palette.yellow };
  return (
    <View
      testID="scanner-reticle"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: "62%", maxWidth: 260, aspectRatio: 1 }}
    >
      <View style={{ ...corner, top: 0, left: 0, borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: radius.card }} />
      <View style={{ ...corner, top: 0, right: 0, borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: radius.card }} />
      <View style={{ ...corner, bottom: 0, left: 0, borderBottomWidth: STROKE, borderLeftWidth: STROKE, borderBottomLeftRadius: radius.card }} />
      <View style={{ ...corner, bottom: 0, right: 0, borderBottomWidth: STROKE, borderRightWidth: STROKE, borderBottomRightRadius: radius.card }} />
    </View>
  );
}
