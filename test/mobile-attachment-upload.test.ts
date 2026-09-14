import { expect, test } from "bun:test";
import { uploadAttachment } from "../mobile/src/omg/attachment-upload";

test("byte progress is monotonic across retries and completes only with a server path", async () => {
  const progress: number[] = [];
  const path = await uploadAttachment({
    fetch: async () => { throw new Error("wrong transport"); },
    upload: async (url, init, report) => {
      expect(url).toBe("/api/uploads?filename=test");
      expect(init.body).toBeInstanceOf(Blob);
      for (const loaded of [4, 2, 10]) report({ loaded, total: 10, lengthComputable: true });
      expect(progress).toEqual([40, 99]);
      return Response.json({ path: "/uploads/test" });
    },
  }, "/api/uploads?filename=test", new Blob(["0123456789"]), "text/plain", "id", p => progress.push(p));
  expect(path).toBe("/uploads/test");
  expect(progress).toEqual([40, 99, 100]);
});

test("chunk progress counts bytes from earlier chunks", async () => {
  const size = 8 * 1024 * 1024;
  const progress: number[] = [];
  const urls: string[] = [];
  await uploadAttachment({
    fetch: async () => { throw new Error("wrong transport"); },
    upload: async (url, init, report) => {
      urls.push(url);
      const body = init.body as Blob;
      report({ loaded: body.size / 2, total: body.size, lengthComputable: true });
      return Response.json(urls.length === 2 ? { path: "/uploads/test" } : { ok: true });
    },
  }, "/api/uploads?filename=test", new Blob([new Uint8Array(size * 2)]), "", "id", p => progress.push(p));
  expect(urls).toEqual([
    `/api/uploads?filename=test&uploadId=id&offset=0&total=${size * 2}`,
    `/api/uploads?filename=test&uploadId=id&offset=${size}&total=${size * 2}`,
  ]);
  expect(progress).toEqual([25, 50, 75, 99, 100]);
});

test("fetch-only transport supports empty files without invented byte progress", async () => {
  const progress: number[] = [];
  let calls = 0;
  await uploadAttachment({ fetch: async () => {
    calls++;
    return Response.json({ path: "/uploads/empty" });
  } }, "/api/uploads?filename=empty", new Blob([]), "", "id", p => progress.push(p));
  expect(calls).toBe(1);
  expect(progress).toEqual([100]);
});

for (const response of [Response.json({}, { status: 500 }), Response.json({ ok: true })]) {
  test(`rejection or missing path never completes (${response.status})`, async () => {
    const progress: number[] = [];
    await expect(uploadAttachment({ fetch: async () => response }, "/api/uploads?filename=test",
      new Blob(["test"]), "", "id", p => progress.push(p))).rejects.toThrow("upload rejected");
    expect(progress).not.toContain(100);
  });
}
