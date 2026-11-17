// macOS readers for the settings Performance and Storage panels. The parsers
// take command output as text, so these run on Linux with real macOS output
// shapes.
import { describe, expect, test } from "bun:test";
import { mountForPath, parseDarwinMountTable } from "./host-disks.ts";
import { availableFromVmStat } from "./host-memory.ts";
import { netTotalsFromNetstat } from "./metrics.ts";

const GIB = 1024 ** 3;

// macOS 14 on a 16 GB Apple silicon Mac (16 KiB pages).
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3594.
Pages active:                            224736.
Pages inactive:                          220437.
Pages speculative:                         2125.
Pages throttled:                              0.
Pages wired down:                         96843.
Pages purgeable:                           9312.
"Translation faults":                 812345678.
Pages copy-on-write:                   12345678.
Pages zero filled:                    345678901.
Pages reactivated:                      1234567.
Pages purged:                            234567.
File-backed pages:                       150102.
Anonymous pages:                         297196.
Pages stored in compressor:              120000.
Pages occupied by compressor:             38291.
Decompressions:                         1234567.
Compressions:                           2345678.
Pageins:                                3456789.
Pageouts:                                 45678.
Swapins:                                      0.
Swapouts:                                     0.
`;

describe("availableFromVmStat", () => {
  test("counts used memory as Activity Monitor does", () => {
    const total = 16 * GIB;
    // App (297196 - 9312) + wired 96843 + compressed 38291 = 423018 pages.
    const used = 423018 * 16384;
    expect(availableFromVmStat(VM_STAT, total)).toBe(total - used);
    // freemem() would have said 3594 pages, about 56 MB: a "99 % full" Mac.
    expect(availableFromVmStat(VM_STAT, total)!).toBeGreaterThan(9 * GIB);
  });

  test("falls back to free + inactive without the anonymous count", () => {
    const old = VM_STAT.replace(/^Anonymous pages:.*$/m, "");
    expect(availableFromVmStat(old, 16 * GIB)).toBe((3594 + 220437) * 16384);
  });

  test("returns null for output it does not know", () => {
    expect(availableFromVmStat("nonsense", 16 * GIB)).toBeNull();
  });
});

describe("parseDarwinMountTable", () => {
  const MOUNT = [
    "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
    "devfs on /dev (devfs, local, nobrowse)",
    "/dev/disk3s6 on /System/Volumes/VM (apfs, local, noexec, journaled, noatime, nobrowse)",
    "/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect)",
    "map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)",
    "/dev/disk5s1 on /Volumes/My Drive (apfs, local, nodev, nosuid, journaled, noowners)",
    "",
  ].join("\n");

  test("reads each mount point, spaces included", () => {
    expect(parseDarwinMountTable(MOUNT).map((m) => m.mount)).toEqual([
      "/",
      "/dev",
      "/System/Volumes/VM",
      "/System/Volumes/Data",
      "/System/Volumes/Data/home",
      "/Volumes/My Drive",
    ]);
  });

  test("puts a home folder on / and an external drive on its own volume", () => {
    const mounts = parseDarwinMountTable(MOUNT);
    // /Users reaches the Data volume through a firmlink. statfs("/") reports
    // the shared APFS container, so `/` is the right row for it.
    expect(mountForPath("/Users/benny/.local/share/omg", mounts)).toBe("/");
    expect(mountForPath("/Volumes/My Drive/worktrees/a", mounts)).toBe("/Volumes/My Drive");
  });
});

describe("netTotalsFromNetstat", () => {
  const NETSTAT = [
    "Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll",
    "lo0        16384 <Link#1>                        123456     0   98765432   123456     0   98765432     0",
    "lo0        16384 127           127.0.0.1         123456     -   98765432   123456     -   98765432     -",
    "en0        1500  <Link#11>   aa:bb:cc:dd:ee:ff  5000000     0 6000000000  2000000     0  300000000     0",
    "en0        1500  192.168.1     192.168.1.5      5000000     -  6000000000 2000000     -  300000000     -",
    "en1*       1500  <Link#12>   aa:bb:cc:dd:ee:00       10     0       1000       20     0       2000     0",
    "utun3      1380  <Link#20>                          100     0      20000      100     0      30000     0",
    "awdl0      1500  <Link#14>   11:22:33:44:55:66      500     0      70000      600     0      80000     0",
  ].join("\n");

  test("sums link rows of real interfaces once each", () => {
    // en0 + en1. Loopback, the tunnel and AirDrop are skipped, and the
    // address rows repeat the link counters.
    expect(netTotalsFromNetstat(NETSTAT)).toEqual({ rx: 6000001000, tx: 300002000 });
  });

  test("returns null with no interfaces", () => {
    expect(netTotalsFromNetstat(NETSTAT.split("\n")[0]!)).toBeNull();
  });
});
