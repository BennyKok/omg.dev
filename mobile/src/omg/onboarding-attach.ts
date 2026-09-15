/**
 * Picking a file BEFORE there is anywhere to put it.
 *
 * Step 03 offers "Add a file or reference" and it runs before sign-in, so
 * there is no account, no Computer and no client. `useAttachments` cannot be
 * used here: it uploads the moment you pick, and with a null client every row
 * would come back marked failed.
 *
 * So this only PICKS. The local URIs ride across sign-in in the handoff and
 * are uploaded by onboarding-launch.ts, once a Computer exists, to the same
 * pre-session endpoint the home composer uses.
 *
 * ── Why the URIs survive ──────────────────────────────────────────────────
 *
 * Both pickers copy into this app's cache directory -- the image picker by
 * default, the document picker because `copyToCacheDirectory` is set below.
 * That copy outlives the process, which matters: Apple and Google sign-in hand
 * off to a system sheet or a browser and the app can be killed while the
 * person is over there. A provider's own URL would have stopped resolving the
 * moment the sheet closed.
 *
 * A file that is gone by the time the upload runs is dropped, not fatal. See
 * onboarding-launch.ts.
 */
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";

import type { AttachmentKind, PickedFile } from "./attachments";
import type { MenuOption } from "./menu";

function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

async function fromLibrary(): Promise<PickedFile[]> {
  /*
   * NO PERMISSION REQUEST. `launchImageLibraryAsync` presents
   * PHPickerViewController, which runs out of process and hands back only what
   * was picked, so iOS grants no library access and asks for none. Asking
   * first put a "would like full access to your Photo Library" alert in front
   * of somebody attaching one screenshot. Same rule as attachments.ts.
   */
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    quality: 0.8,
    selectionLimit: 4,
    // Not passthrough: that path reads a video through PHAsset and asks for
    // the full-library permission the comment above exists to avoid.
    videoExportPreset: ImagePicker.VideoExportPreset.HighestQuality,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => {
    const video = asset.type === "video";
    return {
      uri: asset.uri,
      name:
        asset.fileName?.trim() ||
        (video ? `video-${Date.now()}.mp4` : `image-${Date.now()}.jpg`),
      mimeType: asset.mimeType || (video ? "video/mp4" : "image/jpeg"),
      kind: video ? ("video" as const) : ("image" as const),
    };
  });
}

async function fromFiles(): Promise<PickedFile[]> {
  let picker: typeof import("expo-document-picker");
  try {
    /*
     * Required lazily. The document picker is a native module that older
     * builds do not carry, and this code reaches them over the air, so a
     * missing module has to degrade to a sentence rather than crash at import.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    picker = require("expo-document-picker") as typeof import("expo-document-picker");
  } catch {
    Alert.alert("Update the app", "Attaching files needs a newer omg app from the App Store.");
    return [];
  }
  const result = await picker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.map((asset) => {
    const mimeType = asset.mimeType || "application/octet-stream";
    return {
      uri: asset.uri,
      name: asset.name?.trim() || `file-${Date.now()}`,
      mimeType,
      kind: kindOf(mimeType),
    };
  });
}

/**
 * The same three rows the paperclip shows everywhere else, minus the camera.
 *
 * Taking a photo is a thing you do about work in progress; nobody photographs
 * something to hand an agent before they have written the task. Leaving it out
 * keeps this sheet to the two that make sense here.
 */
export function onboardingAttachOptions(onPicked: (files: PickedFile[]) => void): MenuOption[] {
  const run = (pick: () => Promise<PickedFile[]>) => () => {
    void pick()
      .then((files) => {
        if (files.length) onPicked(files);
      })
      .catch(() => {
        // The sheet failed or was dismissed oddly. Nothing was promised yet,
        // so there is nothing to report and nothing to clean up.
      });
  };
  return [
    { label: "Photo Library", icon: "photo.on.rectangle", onPress: run(fromLibrary) },
    { label: "Choose File", icon: "folder", onPress: run(fromFiles) },
  ];
}
