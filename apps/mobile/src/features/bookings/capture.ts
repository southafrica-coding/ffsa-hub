// Vehicle-check photos: camera or library → compressed JPEG in the bookings
// outbox folder, ready to queue. Same approach as finance's receipt capture
// (system camera UI via expo-image-picker, permission asked just in time
// after a plain reason), reusing its resize plan, safe file names and
// permission rule; only the wording and the destination folder differ.

import * as Crypto from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert, Linking } from "react-native";

import { permissionStep } from "@/features/finance/capture";
import { planReceiptResize, safeFileName } from "@/features/finance/image-plan";

import { keepPhoto } from "./outbox/store";
import { strings } from "./strings";

export type DraftPhoto = { localUri: string; fileName: string; mimeType: "image/jpeg" };

const s = strings.capture;

function confirm(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      s.cameraTitle,
      s.cameraRationale,
      [
        { text: s.notNow, style: "cancel", onPress: () => resolve(false) },
        { text: s.continue, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function offerSettings(message: string) {
  Alert.alert(s.cameraTitle, message, [
    { text: s.notNow, style: "cancel" },
    { text: s.openSettings, onPress: () => void Linking.openSettings() },
  ]);
}

async function ensureCamera(): Promise<boolean> {
  let p = await ImagePicker.getCameraPermissionsAsync();
  let step = permissionStep(p);
  if (step === "ask") {
    if (!(await confirm())) return false;
    p = await ImagePicker.requestCameraPermissionsAsync();
    step = permissionStep(p);
  }
  if (step === "launch") return true;
  offerSettings(s.cameraDenied);
  return false;
}

async function prepare(asset: { uri: string; width: number; height: number; fileName?: string | null }): Promise<DraftPhoto> {
  const plan = planReceiptResize(asset.width, asset.height);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (plan.resize) ctx.resize(plan.resize);
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: plan.compress, format: SaveFormat.JPEG });
  const kept = keepPhoto(out.uri, `${Crypto.randomUUID()}.jpg`);
  return { localUri: kept.uri, fileName: safeFileName(asset.fileName, "vehicle-photo.jpg"), mimeType: "image/jpeg" };
}

async function prepareAll(result: ImagePicker.ImagePickerResult): Promise<DraftPhoto[]> {
  if (result.canceled) return [];
  const out: DraftPhoto[] = [];
  for (const a of result.assets) out.push(await prepare(a));
  return out;
}

export async function takeVehiclePhoto(): Promise<DraftPhoto[]> {
  if (!(await ensureCamera())) return [];
  return prepareAll(await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false }));
}

export async function chooseVehiclePhotos(): Promise<DraftPhoto[]> {
  try {
    return await prepareAll(
      await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 10, quality: 1, exif: false }),
    );
  } catch (err) {
    if (err instanceof Error && /permission/i.test(err.message)) {
      offerSettings(s.libraryDenied);
      return [];
    }
    throw err;
  }
}
