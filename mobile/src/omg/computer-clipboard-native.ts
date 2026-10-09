import * as Clipboard from "expo-clipboard";

export async function readDeviceClipboard(): Promise<string> {
  return Clipboard.getStringAsync();
}

export async function writeDeviceClipboard(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}
