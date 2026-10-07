import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./config.ts";

// The machine owns thread delivery and the receiver's blocks together.
// Participant ids are opaque; no addresses are kept in this store.
type Blocks = Record<string, string[]>;
function path() { return join(PATHS.data, "threads", "blocks.json"); }
function read(): Blocks {
  try { return JSON.parse(readFileSync(path(), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error; // Do not silently discard a user's blocks after a read failure.
  }
}

export function blockedThreadParticipants(viewer: string): string[] {
  return read()[viewer] ?? [];
}

export function isThreadParticipantBlocked(viewer: string, sender: string): boolean {
  return blockedThreadParticipants(viewer).includes(sender);
}

export function setThreadParticipantBlocked(viewer: string, sender: string, blocked: boolean): string[] {
  if (!/^human:[a-z0-9_-]+$/i.test(viewer) || !/^human:[a-z0-9_-]+$/i.test(sender) || viewer === sender) {
    throw new Error("Invalid block participant");
  }
  const data = read();
  const next = new Set(data[viewer] ?? []);
  if (blocked) next.add(sender); else next.delete(sender);
  if (next.size > 1000) throw new Error("Too many blocked participants");
  if (next.size) data[viewer] = [...next]; else delete data[viewer];
  mkdirSync(join(PATHS.data, "threads"), { recursive: true });
  const temp = `${path()}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  renameSync(temp, path());
  return [...next];
}
