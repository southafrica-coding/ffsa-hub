// Receipt capture: camera or photo library → compressed JPEG in the outbox
// folder, ready to queue.
//
// expo-image-picker rather than expo-camera: a receipt needs one good still,
// and the system camera UI gives focus, flash, retake and accessibility for
// free, with no viewfinder screen to build. The library uses the system
// photo picker, which needs no photo permission on iOS 14+ or Android 13+.
// The camera permission is asked just in time, after a plain-English reason.

import * as Crypto from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert, Linking } from "react-native";

import { planReceiptResize, safeFileName } from "./image-plan";
import { keepPhoto } from "./outbox/store";
import { strings } from "./strings";

export type DraftPhoto = {
  localUri: string;
  fileName: string;
  fileSize: number;
  mimeType: "image/jpeg";
};

type PermissionLike = { granted: boolean; canAskAgain: boolean };

/** What to do with the camera permission as it stands. */
export function permissionStep(p: PermissionLike): "launch" | "ask" | "settings" {
  if (p.granted) return "launch";
  return p.canAskAgain ? "ask" : "settings";
}

function confirm(title: string, message: string, ok: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: strings.capture.notNow, style: "cancel", onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

function offerSettings(message: string) {
  Alert.alert(strings.capture.cameraRationaleTitle, message, [
    { text: strings.capture.notNow, style: "cancel" },
    { text: strings.capture.openSettings, onPress: () => void Linking.openSettings() },
  ]);
}

async function ensureCamera(): Promise<boolean> {
  let p = await ImagePicker.getCameraPermissionsAsync();
  let step = permissionStep(p);
  if (step === "ask") {
    const go = await confirm(strings.capture.cameraRationaleTitle, strings.capture.cameraRationale, strings.capture.continue);
    if (!go) return false;
    p = await ImagePicker.requestCameraPermissionsAsync();
    step = permissionStep(p);
  }
  if (step === "launch") return true;
  offerSettings(strings.capture.cameraDenied);
  return false;
}

/** Resize (long edge ≤ 1600px), re-encode as JPEG 0.7, keep it in the outbox folder. */
export async function prepareReceipt(asset: { uri: string; width: number; height: number; fileName?: string | null }): Promise<DraftPhoto> {
  const plan = planReceiptResize(asset.width, asset.height);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (plan.resize) ctx.resize(plan.resize);
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: plan.compress, format: SaveFormat.JPEG });
  const kept = keepPhoto(out.uri, `${Crypto.randomUUID()}.jpg`);
  return {
    localUri: kept.uri,
    fileName: safeFileName(asset.fileName),
    fileSize: kept.size,
    mimeType: "image/jpeg",
  };
}

async function prepareAll(result: ImagePicker.ImagePickerResult): Promise<DraftPhoto[]> {
  if (result.canceled) return [];
  const out: DraftPhoto[] = [];
  for (const a of result.assets) out.push(await prepareReceipt(a));
  return out;
}

export async function takeReceiptPhoto(): Promise<DraftPhoto[]> {
  if (!(await ensureCamera())) return [];
  return prepareAll(await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false }));
}

export async function chooseReceiptPhotos(): Promise<DraftPhoto[]> {
  try {
    return await prepareAll(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 1,
        exif: false,
      }),
    );
  } catch (err) {
    // Older Androids/iOS without the system picker may still need access.
    if (err instanceof Error && /permission/i.test(err.message)) {
      offerSettings(strings.capture.libraryDenied);
      return [];
    }
    throw err;
  }
}
