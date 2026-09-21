import { expect, test } from "bun:test";

test("no-project creation through the real HTTP handler", async () => {
  const child = Bun.spawn([process.execPath, "run", "test/fixtures/no-project-http.ts"], {
    cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ code, errors: code ? out + err : "" }).toEqual({ code: 0, errors: "" });
  expect(out).toContain("PASS: real HTTP handler");
}, 30_000);
