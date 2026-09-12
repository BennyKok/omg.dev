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

import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";

import type { MenuOption } from "./menu";
import { useOmg } from "./provider";

export type AttachmentKind = "image" | "video" | "file";

export type Attachment = {
  /** Local, stable for the row's lifetime; the server's name is not unique. */
  id: string;
  name: string;
  /** Local file URI — what the thumbnail draws from. */
  uri: string;
  /** What the strip draws: a thumbnail for an image, a glyph for the rest. */
  kind: AttachmentKind;
  /** Absolute path ON THE COMPUTER. Null until the upload lands. */
  path: string | null;
  failed?: boolean;
};

/** Anything picked, from whichever picker: enough to upload and to draw a row. */
export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
};

/**
 * Same split as the web's `uploadFile`: the machine caps one request body at
 * 32 MB, so a video goes up in 8 MB parts under one `uploadId`, and the
 * server's chunk route stitches them in order. Small files still take the
 * one-shot route.
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

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
    async (file: PickedFile, id: string) => {
      if (!client) return;
      try {
        const blob = await readAsBlob(file.uri);
        const endpoint = sessionId
          ? `/api/sessions/${sessionId}/upload`
          : "/api/uploads";
        const base = `${endpoint}?filename=${encodeURIComponent(file.name)}`;
        const headers = { "Content-Type": file.mimeType || "application/octet-stream" };
        const post = async (query: string, body: Blob) => {
          const response = await client.transport.fetch(`${base}${query}`, {
            method: "POST",
            headers,
            body,
          });
          const parsed = (await response.json().catch(() => ({}))) as { ok?: boolean; path?: string };
          if (!response.ok) throw new Error("upload rejected");
          return parsed;
        };
        let result: { path?: string } = {};
        if (blob.size > CHUNK_BYTES) {
          const uploadId = Crypto.randomUUID();
          for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
            const part = blob.slice(offset, Math.min(blob.size, offset + CHUNK_BYTES));
            result = await post(`&uploadId=${uploadId}&offset=${offset}&total=${blob.size}`, part);
          }
        } else {
          result = await post("", blob);
        }
        if (!result.path) throw new Error("upload rejected");
        const path = result.path;
        setItems((current) =>
          current.map((item) => (item.id === id ? { ...item, path } : item)),
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

  /** One row per picked file, then the upload in the background. */
  const add = useCallback(
    (files: PickedFile[]) => {
      for (const file of files) {
        const id = `att-${++seq}`;
        setItems((current) => [
          ...current,
          { id, name: file.name, uri: file.uri, kind: file.kind, path: null },
        ]);
        void upload(file, id);
      }
    },
    [upload],
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
                // Videos too. A screen recording of the bug is the attachment
                // people reach for most after a screenshot.
                mediaTypes: ["images", "videos"],
                quality: 0.8,
                selectionLimit: 4,
              });
        if (result.canceled) return;

        add(
          result.assets.map((asset) => {
            const video = asset.type === "video";
            return {
              uri: asset.uri,
              name:
                asset.fileName?.trim() ||
                (video ? `video-${Date.now()}.mp4` : `image-${Date.now()}.jpg`),
              mimeType: asset.mimeType || (video ? "video/mp4" : "image/jpeg"),
              kind: video ? "video" : "image",
            };
          }),
        );
      } finally {
        setPicking(false);
      }
    },
    [picking, add],
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
