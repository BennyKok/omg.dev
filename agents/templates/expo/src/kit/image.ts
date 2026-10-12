// Make picked images survive a reload.
//
// Why: image pickers on web return `blob:` URLs that die with the page, and on
// native a cache `file:` path the OS may clear. Store the DATA URL instead.
//
//   const r = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
//   if (!r.canceled) item.photo = await toPersistentImage(r.assets[0]);
//
// A data URL is a plain string: keep it in AsyncStorage next to the item and
// render it with <Image source={{ uri: item.photo }} />. Use quality 0.5 or
// lower: web localStorage holds about 5 MB in total.
export type PickedAsset = { uri: string; base64?: string | null; mimeType?: string | null };

export type ImageDeps = {
  /** Reads any readable URI (blob:, file:, http:) into a data URL. */
  readAsDataUrl: (uri: string) => Promise<string>;
};

export const MAX_IMAGE_CHARS = 1_500_000;

async function defaultRead(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}

export async function toPersistentImage(
  asset: PickedAsset | string,
  deps: ImageDeps = { readAsDataUrl: defaultRead },
  maxChars = MAX_IMAGE_CHARS,
): Promise<string> {
  const a: PickedAsset = typeof asset === "string" ? { uri: asset } : asset;
  let url: string;
  if (a.uri.startsWith("data:")) url = a.uri;
  else if (a.base64) url = `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
  else url = await deps.readAsDataUrl(a.uri);
  if (url.length > maxChars) throw new Error("That image is too large. Pick a smaller one or lower the picker quality.");
  return url;
}

/** True for URLs that will not survive a reload. */
export function isEphemeralUri(uri: string): boolean {
  return uri.startsWith("blob:");
}
