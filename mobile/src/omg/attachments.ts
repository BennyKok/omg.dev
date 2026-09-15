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
import { useCallback, useState } from "react";

import { composeAttachmentMessage } from "./attachment-message";
import { uploadAttachment } from "./attachment-upload";
import { filePickerOptions } from "./file-picker";
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
  /** Uploaded percentage; 100 means the server accepted the file. */
  progress?: number;
};

/** Anything picked, from whichever picker: enough to upload and to draw a row. */
export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
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
    async (file: PickedFile, id: string) => {
      try {
        if (!client) throw new Error("No computer connected");
        const blob = await readAsBlob(file.uri);
        const endpoint = sessionId
          ? `/api/sessions/${sessionId}/upload`
          : "/api/uploads";
        const base = `${endpoint}?filename=${encodeURIComponent(file.name)}`;
        const path = await uploadAttachment(
          client.transport, base, blob, file.mimeType, Crypto.randomUUID(),
          (progress) => setItems((current) => current.map((item) =>
            item.id === id ? { ...item, progress } : item)),
        );
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

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  /**
   * The message the agent actually receives. The block's shape lives in
   * attachment-message.ts, shared with the onboarding launch, because the web
   * parses it back off and a one-character difference breaks that.
   */
  const compose = useCallback(
    (text: string) =>
      composeAttachmentMessage(
        text,
        items.flatMap((item) => (item.path ? [{ name: item.name, path: item.path }] : [])),
      ),
    [items],
  );

  /**
   * Rows for the paperclip's menu. The picking lives in file-picker.ts,
   * shared with onboarding step 03 -- which picks before there is anywhere to
   * upload to, and so cannot use this hook at all. Everything those two
   * surfaces have in common is the pick; everything after it differs.
   */
  const options: MenuOption[] = filePickerOptions(add, {
    busy: () => picking,
    setBusy: setPicking,
  });

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
