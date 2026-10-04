import { describe, expect, test } from "bun:test";
import { decodeMountPath, mountForPath, parseMountTable } from "./host-disks.ts";

const TABLE = [
  "/dev/sda1 / ext4 rw 0 0",
  "/dev/sdb1 /mnt/data ext4 rw 0 0",
  "tmpfs /tmp tmpfs rw 0 0",
  "/dev/sda1 /home/dev/odd\\040name ext4 rw 0 0",
].join("\n");

describe("host disk mounts", () => {
  test("decodes escaped spaces in mount paths", () => {
    expect(decodeMountPath("/home/dev/odd\\040name")).toBe("/home/dev/odd name");
  });

  test("picks the longest mount that contains the path", () => {
    const mounts = parseMountTable(TABLE);
    expect(mountForPath("/home/dev/lfg-serve-main/data", mounts)).toBe("/");
    expect(mountForPath("/mnt/data/lfg-worktrees/lfg-abc", mounts)).toBe("/mnt/data");
    expect(mountForPath("/tmp/scratch", mounts)).toBe("/tmp");
  });
});
