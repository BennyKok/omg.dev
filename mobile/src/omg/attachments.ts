/**
 * Files the user hands the agent.
 *
 * ATTACHMENTS TRAVEL AS TEXT, and that is not a shortcut — it is the contract
 * the whole product already speaks. The bytes are uploaded to the COMPUTER,
 * which writes them into its uploads dir and hands back an absolute path; the
 * message then carries that path in a trailing block:
 *
 *     Attached files:
 *     - IMG_0850.png: /tmp/lfg-uploads/…-IMG_0850.png
 *
 * Coding agents read local files, so the path IS the delivery mechanism.
 * `composeAttachmentMessage` in web/src/App.tsx builds the identical block, and
 * web/src/lib/message-attachments.ts parses it back off for display — diverge
 * here by a character and the same message renders as a path on one surface and
 * a picture on the other.
 *
 * The upload goes through `client.transport`, never a bare fetch: the transport
 * owns the grant, its refresh, and the base URL of whichever computer is
 * selected. A hand-rolled fetch would have to re-derive all three and would
 * silently target the wrong machine after a switch.
 */

import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";

import type { MenuOption } from "./menu";
import { useOmg } from "./provider";

export type Attachment = {
  /** Local, stable for the row's lifetime; the server's name is not unique. */
  id: string;
  name: string;
  /** Local file URI — what the thumbnail draws from. */
  uri: string;
  /** Absolute path ON THE COMPUTER. Null until the upload lands. */
  path: string | null;
  failed?: boolean;
};

let seq = 0;

/**
 * Turn a picked asset into bytes the machine can store.
 *
 * A Blob, not base64: the endpoint reads `req.arrayBuffer()` and writes it
 * straight to disk, so base64 would arrive as text and produce a corrupt file.
 * React Native's fetch can read a `file://` URI into a Blob and can send one as
 * a body, which is the only pair of those two facts that works without pulling
 * in a filesystem module.
 */
async function readAsBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return await response.blob();
}

/**
 * @param sessionId The session to attach to, or null for the home composer —
 * which has no session yet and uploads to the pre-session endpoint instead.
 */
export function useAttachments(sessionId: string | null) {
  const { client } = useOmg();
  const [items, setItems] = useState<Attachment[]>([]);
  const [picking, setPicking] = useState(false);

  const upload = useCallback(
    async (asset: ImagePicker.ImagePickerAsset, id: string, name: string) => {
      if (!client) return;
      try {
        const blob = await readAsBlob(asset.uri);
        const endpoint = sessionId
          ? `/api/sessions/${sessionId}/upload`
          : "/api/uploads";
        const response = await client.transport.fetch(
          `${endpoint}?filename=${encodeURIComponent(name)}`,
          {
            method: "POST",
            headers: { "Content-Type": asset.mimeType || "application/octet-stream" },
            body: blob,
          },
        );
        const body = (await response.json()) as { ok?: boolean; path?: string };
        if (!response.ok || !body?.path) throw new Error("upload rejected");
        setItems((current) =>
          current.map((item) => (item.id === id ? { ...item, path: body.path! } : item)),
        );
      } catch {
        // Kept in the list rather than dropped: a row that vanishes looks like
        // the attach never happened, and the user cannot retry what is gone.
        setItems((current) =>
          current.map((item) => (item.id === id ? { ...item, failed: true } : item)),
        );
      }
    },
    [client, sessionId],
  );

  const take = useCallback(
    async (source: "library" | "camera") => {
      if (picking) return;
      setPicking(true);
      try {
        /**
         * ONLY THE CAMERA ASKS. `launchImageLibraryAsync` presents
         * PHPickerViewController, which runs OUT OF PROCESS and hands back
         * only what the user picked — so iOS grants it no library access and
         * asks for none. Calling `requestMediaLibraryPermissionsAsync` first
         * put a "would like full access to your Photo Library" alert in front
         * of someone who wanted to attach one screenshot, and full access is
         * not a thing this app ever needs. Verified on the simulator: the
         * prompt appeared for the library path and stopped once this went.
         */
        if (source === "camera") {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) return;
        }

        const result =
          source === "camera"
            ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 0.8,
                selectionLimit: 4,
              });
        if (result.canceled) return;

        for (const asset of result.assets) {
          const id = `att-${++seq}`;
          const name = asset.fileName?.trim() || `image-${Date.now()}.jpg`;
          setItems((current) => [...current, { id, name, uri: asset.uri, path: null }]);
          void upload(asset, id, name);
        }
      } finally {
        setPicking(false);
      }
    },
    [picking, upload],
  );

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  /**
   * The message the agent actually receives. Byte-identical in shape to the
   * web's `composeAttachmentMessage`, including the singular/plural label and
   * the blank line before the block.
   */
  const compose = useCallback(
    (text: string) => {
      const ready = items.filter((item) => item.path);
      if (!ready.length) return text;
      const label = ready.length === 1 ? "Attached file" : "Attached files";
      const list = ready.map((item) => `- ${item.name}: ${item.path}`).join("\n");
      return [text, `${label}:\n${list}`].filter(Boolean).join("\n\n");
    },
    [items],
  );

  /** Rows for the paperclip's menu — the same control every other pick uses. */
  const options: MenuOption[] = [
    {
      label: "Photo Library",
      icon: "photo.on.rectangle",
      onPress: () => void take("library"),
    },
    { label: "Take Photo", icon: "camera", onPress: () => void take("camera") },
  ];

  return {
    items,
    options,
    remove,
    clear,
    compose,
    /** True while any attachment is still on its way to the computer. */
    uploading: items.some((item) => !item.path && !item.failed),
  };
}
