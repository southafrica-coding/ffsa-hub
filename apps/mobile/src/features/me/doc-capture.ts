// Photographing an identity document (licence, passport page).
//
// Same approach as finance's receipt capture (system camera / photo picker
// via expo-image-picker, camera permission asked just in time after a plain
// reason, same resize plan), with two deliberate differences because these
// are POPIA-sensitive documents:
//   - The photo is NOT queued in an offline outbox or kept in the app's
//     documents folder. It's compressed into the cache folder, uploaded
//     straight away, and every local copy is deleted afterwards (success or
//     not). Offline = a clear "connect and try again", never a stored copy.
//   - The upload's file name is generic ("licence.jpg"), so nothing from the
//     phone's own file names (dates, places) goes to the server.

import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert, Linking } from "react-native";

import { permissionStep } from "@/features/finance/capture";
import { planReceiptResize } from "@/features/finance/image-plan";

import type { PhotoPart } from "./docs-api";
import { meStrings } from "./strings";

const s = meStrings.docs.file;

export type DocPhoto = PhotoPart & { cleanup: () => void };

/**
 * How the screen asks. DocFile passes its own bottom sheet ("Use the
 * camera?", redesign frame 6.7); without one the system alert is used.
 */
export type CapturePrompts = {
  /** Our plain reason, shown before the phone's own camera prompt. Resolves true to carry on. */
  explainCamera: () => Promise<boolean>;
  /** Access is switched off in the phone's Settings: say so and offer Open Settings. */
  accessOff: (message: string) => void;
};

const alertPrompts: CapturePrompts = {
  explainCamera: () =>
    new Promise((resolve) => {
      Alert.alert(
        s.cameraTitle,
        s.cameraRationale,
        [
          { text: s.notNow, style: "cancel", onPress: () => resolve(false) },
          { text: s.continue, onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    }),
  accessOff: (message) => {
    Alert.alert(s.cameraTitle, message, [
      { text: s.notNow, style: "cancel" },
      { text: s.openSettings, onPress: () => void Linking.openSettings() },
    ]);
  },
};

async function ensureCamera(prompts: CapturePrompts): Promise<boolean> {
  let p = await ImagePicker.getCameraPermissionsAsync();
  let step = permissionStep(p);
  if (step === "ask") {
    if (!(await prompts.explainCamera())) return false;
    p = await ImagePicker.requestCameraPermissionsAsync();
    step = permissionStep(p);
  }
  if (step === "launch") return true;
  prompts.accessOff(s.cameraDenied);
  return false;
}

/**
 * Best-effort delete of our local copies; never throws. Only files in the
 * app's cache folder (where the picker and the compressor write) are touched,
 * never a photo in the person's own library.
 */
export function deleteLocal(uris: string[], cacheDir: string = Paths.cache.uri) {
  const dir = cacheDir.endsWith("/") ? cacheDir : `${cacheDir}/`;
  for (const uri of uris) {
    if (!uri.startsWith(dir) || uri.includes("..")) continue;
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // Already gone, or not ours to delete: the OS clears the cache folder too.
    }
  }
}

async function prepare(result: ImagePicker.ImagePickerResult, name: string): Promise<DocPhoto | null> {
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  try {
    const plan = planReceiptResize(asset.width, asset.height);
    const ctx = ImageManipulator.manipulate(asset.uri);
    if (plan.resize) ctx.resize(plan.resize);
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: plan.compress, format: SaveFormat.JPEG });
    return { uri: out.uri, name, type: "image/jpeg", cleanup: () => deleteLocal([out.uri, asset.uri]) };
  } catch (err) {
    deleteLocal([asset.uri]);
    throw err;
  }
}

/** Take a photo of the document. null when cancelled or permission refused. */
export async function takeDocPhoto(name: string, prompts: CapturePrompts = alertPrompts): Promise<DocPhoto | null> {
  if (!(await ensureCamera(prompts))) return null;
  return prepare(await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false }), name);
}

/** Choose an existing photo. null when cancelled. */
export async function chooseDocPhoto(name: string, prompts: CapturePrompts = alertPrompts): Promise<DocPhoto | null> {
  try {
    return await prepare(
      await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1, exif: false }),
      name,
    );
  } catch (err) {
    if (err instanceof Error && /permission/i.test(err.message)) {
      prompts.accessOff(s.libraryDenied);
      return null;
    }
    throw err;
  }
}
