/** Account-scoped, bounded snapshots. Network state remains authoritative. */
export type CacheStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};
type Snapshot = { at: number; value: unknown };
const PREFIX = "omg:session-cache:v1:";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export class SessionCacheStore {
  private entries = new Map<string, Snapshot>();
  private account: string | null = null;
  private storage: CacheStorage | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  get epoch() { return this.generation; }
  async open(account: string | null, storage: CacheStorage) {
    if (this.account === account && this.storage === storage) return;
    await this.flush();
    const generation = ++this.generation;
    this.account = account;
    this.storage = storage;
    this.entries.clear();
    if (!account) return;
    try {
      const raw = await storage.getItem(PREFIX + account);
      if (generation !== this.generation || !raw || raw.length > MAX_BYTES) return;
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) return;
      for (const row of rows.slice(-64)) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || !row[1] ||
          typeof row[1].at !== "number" || Date.now() - row[1].at > MAX_AGE) continue;
        this.entries.set(row[0], row[1]);
      }
    } catch { /* A missing/corrupt cache never prevents opening the app. */ }
  }
  read<T>(key: string): T | null {
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.at <= MAX_AGE ? entry.value as T : null;
  }
  write(key: string, value: unknown) {
    if (!this.account) return;
    // Skip unusually large pages rather than evicting the entire roster to
    // fit one tool result. The server can still serve that page on demand.
    if (JSON.stringify(value)?.length > 512 * 1024) return;
    this.entries.delete(key);
    this.entries.set(key, { at: Date.now(), value });
    while (this.entries.size > 64) this.entries.delete([...this.entries.keys()].find(key => key !== "binding")!);
    if (!this.timer) this.timer = setTimeout(() => { void this.flush(); }, 300);
  }
  remove(key: string) { this.entries.delete(key); void this.flush(); }
  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const { account, storage } = this;
    if (!account || !storage) return;
    const rows = [...this.entries].sort(([a], [b]) => Number(a === "binding") - Number(b === "binding"));
    let encoded = JSON.stringify(rows);
    while (encoded.length > MAX_BYTES && rows.length) {
      rows.shift();
      encoded = JSON.stringify(rows);
    }
    this.writes = this.writes.catch(() => {}).then(() => storage.setItem(PREFIX + account, encoded));
    await this.writes.catch(() => {});
  }
  async clear() {
    const { account, storage } = this;
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.account = null;
    this.entries.clear();
    await this.writes.catch(() => {});
    if (account && storage) await storage.removeItem(PREFIX + account).catch(() => {});
  }
}
export const sessionCache = new SessionCacheStore();
