import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetStore, sha256, validateDataset } from "../extension/src/background/dataset.js";

// Exercise activation boundaries without browser APIs or external network requests.
const seed = () => ({
  meta: { format: 6, count: 1 }, id: [1], flags: [1], pop: [0],
  tl: "tsi̍t", hanzi: "一", poj: "chi̍t", tps: "ㆡㄧ㆐ㆵ", tlNum: "tsit8",
  tpsNotoneVar: "", abTl: "t", abPoj: "c", abTps: "", gloss: "數目。",
});

async function fixture({ saved = null, remote = seed(), offline = false, badHash = false, badFormat = false } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(remote));
  const descriptor = { format: badFormat ? 7 : 6, sha256: await sha256(bytes), bytes: bytes.length };
  descriptor.file = `${descriptor.sha256}.json`;
  const calls = { seed: 0, descriptor: 0, download: 0, writes: 0 };
  let time = 100 * 86400000;
  const options = {
    seedUrl: "seed.json",
    read: async () => saved,
    write: async (value) => { saved = structuredClone(value); calls.writes++; },
    fetchJson: async (url) => {
      if (url === "seed.json") { calls.seed++; return seed(); }
      calls.descriptor++;
      if (offline) throw new Error("Offline");
      return descriptor;
    },
    fetchBytes: async () => { calls.download++; return badHash ? new Uint8Array(bytes.length) : bytes; },
    now: () => time,
    warn: () => {},
  };
  return { store: createDatasetStore(options), calls, saved: () => saved,
    restart: () => createDatasetStore(options), advance: () => { time += 86400001; },
    setTime: value => { time = value; } };
}

test("offline first use seeds persistent data; failures are throttled across restarts", async () => {
  const f = await fixture({ offline: true });
  assert.deepEqual(await f.store.get(), seed());
  await f.store.check();
  assert.deepEqual(await f.restart().get(), seed());
  await f.restart().check();
  assert.equal(f.calls.seed, 1);
  assert.equal(f.calls.descriptor, 1);
  f.advance();
  await f.store.check();
  assert.equal(f.calls.descriptor, 2);
});

test("validated update replaces seed and survives restart; unchanged hash avoids download", async () => {
  const remote = { ...seed(), hanzi: "蜀" };
  const f = await fixture({ remote });
  await f.store.check();
  assert.deepEqual(await f.store.get(), remote);
  assert.deepEqual(await f.restart().get(), remote);
  f.advance();
  await f.store.check();
  assert.equal(f.calls.download, 1);
  assert.equal(f.calls.descriptor, 2);
});

for (const [name, options] of [
  ["corrupted download", { badHash: true }],
  ["incompatible descriptor", { badFormat: true }],
  ["incompatible data", { remote: { ...seed(), meta: { format: 7, count: 1 } } }],
  ["invalid row counts", { remote: { ...seed(), id: [] } }],
]) {
  test(`${name} retains the validated local dataset`, async () => {
    const f = await fixture(options);
    await f.store.check();
    assert.deepEqual(await f.store.get(), seed());
    assert.deepEqual(f.saved().data, seed());
  });
}

test("invalid cached data is replaced with the packaged seed", async () => {
  const f = await fixture({ saved: { data: {} }, offline: true });
  assert.deepEqual(await f.store.get(), seed());
  assert.equal(f.calls.seed, 1);
});

test("concurrent readers and update checks share one load and download", async () => {
  const f = await fixture({ remote: { ...seed(), hanzi: "蜀" } });
  await Promise.all([f.store.check(), f.store.check(), f.store.get()]);
  assert.equal(f.calls.seed, 1);
  assert.equal(f.calls.download, 1);
});

test("packaged dictionary already matching the published hash needs no download", async () => {
  const f = await fixture();
  await f.store.check();
  assert.equal(f.calls.download, 0);
});

test("checks reset exactly at 09:00 Taiwan time rather than 24 hours after the last check", async () => {
  const f = await fixture();
  f.setTime(Date.parse("2026-10-27T08:59:59+08:00"));
  await f.store.check();
  assert.equal(f.calls.descriptor, 1);
  // trace: 09:00 Taiwan = 01:00 UTC; a new fixed daily window starts one second later.
  f.setTime(Date.parse("2026-10-27T09:00:00+08:00"));
  await f.store.check();
  assert.equal(f.calls.descriptor, 2);
  f.setTime(Date.parse("2026-10-28T08:59:59+08:00"));
  await f.restart().check();
  assert.equal(f.calls.descriptor, 2);
  f.setTime(Date.parse("2026-10-28T09:00:00+08:00"));
  await f.restart().check();
  assert.equal(f.calls.descriptor, 3);
});

test("an inactive browser checks once on first use after the shared daily boundary", async () => {
  const f = await fixture();
  f.setTime(Date.parse("2026-10-27T20:00:00+08:00"));
  await f.store.check();
  f.setTime(Date.parse("2026-10-28T09:00:00+08:00"));
  await f.restart().check();
  assert.equal(f.calls.descriptor, 2);
  await f.restart().check();
  assert.equal(f.calls.descriptor, 2);
});

test("failed persistence never activates a new dataset", async () => {
  const initial = { data: seed(), hash: null, checkedAt: 0 };
  const remote = { ...seed(), hanzi: "蜀" };
  const bytes = new TextEncoder().encode(JSON.stringify(remote));
  const hash = await sha256(bytes);
  const store = createDatasetStore({
    read: async () => initial,
    write: async () => { throw new Error("Disk full"); },
    fetchJson: async () => ({ format: 6, sha256: hash, file: `${hash}.json`, bytes: bytes.length }),
    fetchBytes: async () => bytes,
    now: () => 100 * 86400000,
    warn: () => {},
  });
  await store.check();
  assert.deepEqual(await store.get(), seed());
});

test("validation rejects unsafe numeric values and malformed string columns", () => {
  assert.throws(() => validateDataset({ ...seed(), pop: [NaN] }));
  assert.throws(() => validateDataset({ ...seed(), tl: "a\nb" }));
  assert.throws(() => validateDataset({ ...seed(), hanzi: null }));
});

test("unreadable cached JSON seeds a new validated snapshot", async () => {
  let written;
  const store = createDatasetStore({
    read: async () => { throw new SyntaxError("Invalid JSON"); },
    write: async (value) => { written = value; },
    fetchJson: async () => seed(),
    warn: () => {},
  });
  assert.deepEqual(await store.get(), seed());
  assert.deepEqual(written.data, seed());
});
