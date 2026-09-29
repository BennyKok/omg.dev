/**
 * Save an authenticated image through the system share sheet.
 *
 * The transcript draws a `?preview=1` webp as a data URI, so there is no file
 * to hand anyone. This pulls the ORIGINAL through the transport (which owns the
 * grant), writes it to the cache with an extension that matches its type, and
 * opens the share sheet on that file URL. iOS lists "Save Image" for an image
 * file, next to Messages, AirDrop and the rest.
 *
 * expo-file-system is already linked in every current build (round-avatar.ts
 * imports it statically), and Share is React Native's own, so this ships over
 * the air.
 */
import { File, Paths } from "expo-file-system";
import { Share } from "react-native";

import { imageCacheName } from "./image-cache";

export async function saveImage(fetchPath: (path: string) => Promise<Response>, path: string): Promise<void> {
  const response = await fetchPath(path);
  if (!response.ok) throw new Error(`image ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const file = new File(Paths.cache, imageCacheName(path, response.headers?.get("content-type")));
  if (file.exists) file.delete();
  file.create();
  // Async in SDK 58. Sharing before it lands hands the sheet an empty file.
  await file.write(bytes);
  await Share.share({ url: file.uri });
}
