import { expect, test } from "bun:test";

// An omitted serve.ts dispatch must fail even if the account handler works.
test("retired pairing returns 410 through the real HTTP router", async () => {
  const child = Bun.spawn([process.execPath, "run", "test/fixtures/cloud-pairing-http.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ code, errors: code ? out + err : "" }).toEqual({ code: 0, errors: "" });
}, 30_000);
