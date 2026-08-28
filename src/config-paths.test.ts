import { describe, expect, test } from "bun:test";
import { runtimeDataDir, runtimeEnvFile } from "./config.ts";

describe("runtime state paths", () => {
  test("uses the source tree for a normal server install", () => {
    expect(runtimeDataDir("/opt/omg", {})).toBe("/opt/omg/data");
    expect(runtimeEnvFile("/opt/omg", {})).toBe("/opt/omg/.env");
  });

  test("allows a packaged runtime to keep mutable state outside the app", () => {
    expect(runtimeDataDir("/read-only/app", { OMG_DATA_DIR: "/Users/me/omg/data" })).toBe(
      "/Users/me/omg/data",
    );
    expect(runtimeEnvFile("/read-only/app", { OMG_ENV_FILE: "/Users/me/omg/.env" })).toBe(
      "/Users/me/omg/.env",
    );
  });

  test("keeps the legacy environment names working", () => {
    expect(runtimeDataDir("/opt/omg", { LFG_DATA_DIR: "/var/lib/omg" })).toBe(
      "/var/lib/omg",
    );
    expect(runtimeEnvFile("/opt/omg", { LFG_ENV_FILE: "/etc/omg.env" })).toBe(
      "/etc/omg.env",
    );
  });
});
