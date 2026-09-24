import { expect, test } from "bun:test";
import { createGrantOwner } from "../src/omg/grant-owner";
const grant = (token = "test") => ({ token, expiresAt: Date.now() + 600000 });

test("parallel forced refreshes share one mint and ordinary readers join it", async () => {
  let calls = 0, finish!: (g: ReturnType<typeof grant>) => void;
  const owner = createGrantOwner(() => { calls++; return new Promise(r => { finish = r; }); });
  const requests = [owner.get({ forceRefresh: true }), owner.get({ forceRefresh: true }), owner.get({ forceRefresh: false })];
  await Promise.resolve(); expect(calls).toBe(1); finish(grant());
  expect(await Promise.all(requests)).toEqual([grant(), grant(), grant()].map(g => ({ ...g, expiresAt: expect.any(Number) })));
  await owner.get({ forceRefresh: false }); expect(calls).toBe(1);
});

test("a failed refresh can be retried", async () => {
  let calls = 0;
  const owner = createGrantOwner(async () => { if (++calls === 1) throw Error("offline"); return grant(); });
  await expect(owner.get({ forceRefresh: true })).rejects.toThrow("offline");
  expect((await owner.get({ forceRefresh: true })).token).toBe("test"); expect(calls).toBe(2);
});

test("reset prevents an older request from populating or clearing the new cache", async () => {
  const finishes: Array<(g: ReturnType<typeof grant>) => void> = [];
  const owner = createGrantOwner(() => new Promise(resolve => finishes.push(resolve)));
  const old = owner.get({ forceRefresh: true }); await Promise.resolve();
  owner.reset();
  const current = owner.get({ forceRefresh: true }); await Promise.resolve();
  finishes[0](grant("old")); await old;
  const joined = owner.get({ forceRefresh: true });
  expect(finishes).toHaveLength(2);
  finishes[1](grant("new")); await current;
  expect((await joined).token).toBe("new");
  expect((await owner.get({ forceRefresh: false })).token).toBe("new");
});
