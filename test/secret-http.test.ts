import { expect, test } from "bun:test";

test("secure saves through the real HTTP handler", async () => {
  const child = Bun.spawn([process.execPath, "run", "test/fixtures/secret-http.ts"], {
    cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ code, errors: code ? out + err : "" }).toEqual({ code: 0, errors: "" });
  expect(out).toContain("PASS: secrets are saved to the project .env on this computer only");
}, 30_000);
