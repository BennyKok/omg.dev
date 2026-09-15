/**
 * Picking files. ONE implementation, for every surface that attaches.
 *
 * The composers pick through `useAttachments`, which uploads immediately.
 * Onboarding step 03 picks before there is an account or a Computer, so it
 * cannot upload yet. Those two differ in what happens AFTER the pick and in
 * nothing else, so the picking itself lives here and both call it.
 *
 * It was briefly written out twice, and the two copies would have drifted on
 * details that are not obvious and are each load-bearing:
 *
 *  - The library picker asks for NO permission. `launchImageLibraryAsync`
 *    presents PHPickerViewController, which runs out of process and hands back
 *    only what was picked, so iOS grants no library access and asks for none.
 *    Calling `requestMediaLibraryPermissionsAsync` first put a "would like full
 *    access to your Photo Library" alert in front of somebody attaching one
 *    screenshot, and full access is not a thing this app ever needs. Only the
 *    camera asks.
 *  - The video preset is NOT passthrough. Passthrough reads a video through
 *    PHAsset, and that path asks for the full-library permission the rule above
 *    exists to avoid. Any other preset reads through the item provider and
 *    re-encodes to mp4, which is also the container agents' tools expect.
 *  - The document picker copies into our cache. A provider's own URL can stop
 *    resolving as soon as the sheet closes, and the upload reads it a beat
 *    later -- or, in onboarding, after a whole sign-in round trip.
 *  - The document picker is a native module older builds do not carry, and
 *    this code reaches them over the air, so it is required lazily and a
 *    missing one degrades to a sentence instead of crashing at import.
 */
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";

import type { AttachmentKind, PickedFile } from "./attachments";
import type { MenuOption } from "./menu";

function fromAssets(assets: ImagePicker.ImagePickerAsset[]): PickedFile[] {
  return assets.map((asset) => {
    const video = asset.type === "video";
    return {
      uri: asset.uri,
      name:
        asset.fileName?.trim() ||
        (video ? `video-${Date.now()}.mp4` : `image-${Date.now()}.jpg`),
      mimeType: asset.mimeType || (video ? "video/mp4" : "image/jpeg"),
      kind: (video ? "video" : "image") as AttachmentKind,
    };
  });
}

export async function pickFromLibrary(): Promise<PickedFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    // Videos too. A screen recording of the bug is the attachment people
    // reach for most after a screenshot.
    mediaTypes: ["images", "videos"],
    quality: 0.8,
    selectionLimit: 4,
    videoExportPreset: ImagePicker.VideoExportPreset.HighestQuality,
  });
  return result.canceled ? [] : fromAssets(result.assets);
}

export async function pickFromCamera(): Promise<PickedFile[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return [];
  const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
  return result.canceled ? [] : fromAssets(result.assets);
}

export async function pickDocument(): Promise<PickedFile[]> {
  let picker: typeof import("expo-document-picker");
  try {
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
      kind: (mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("video/")
          ? "video"
          : "file") as AttachmentKind,
    };
  });
}

/**
 * The three rows the plus button shows, everywhere.
 *
 * `busy` is the composers' re-entrancy guard: a second sheet opened over the
 * first is how a picker ends up handing back the same asset twice. Onboarding
 * has no such state and passes nothing.
 */
export function filePickerOptions(
  onPicked: (files: PickedFile[]) => void,
  guard?: { busy: () => boolean; setBusy: (value: boolean) => void },
): MenuOption[] {
  const run = (pick: () => Promise<PickedFile[]>) => () => {
    if (guard?.busy()) return;
    guard?.setBusy(true);
    void pick()
      .then((files) => {
        if (files.length) onPicked(files);
      })
      .catch(() => {
        // The sheet failed or was dismissed oddly. Nothing was promised, so
        // there is nothing to report and nothing to clean up.
      })
      .finally(() => guard?.setBusy(false));
  };
  return [
    { label: "Photo Library", icon: "photo.on.rectangle", onPress: run(pickFromLibrary) },
    { label: "Take Photo", icon: "camera", onPress: run(pickFromCamera) },
    { label: "Choose File", icon: "folder", onPress: run(pickDocument) },
  ];
}
