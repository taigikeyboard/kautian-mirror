import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchUpstream, gitBlobSha, SOURCES } from "../scripts/fetch-upstream.mjs";

// Verify deployment decisions and download reuse against isolated inputs and a simulated upstream.
async function fixture(t, { changed = [], publishedChanges = {}, status = 200, corrupt = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "kautian-upstream-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(`${directory}/`);
  await mkdir(new URL("extension/", root));
  const files = Object.fromEntries(Object.keys(SOURCES).map(name => [name, Buffer.from(`source ${name}`)]));
  const blobs = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, gitBlobSha(bytes)]));
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(new URL(`extension/${name}`, root), changed.includes(name) ? "old data" : bytes);
  }
  const siteCommit = "b".repeat(40);
  // Upstream commit differs from the published commit; unrelated upstream commits must still skip.
  const published = { format: 6, source: { blobs, siteCommit, commit: "c".repeat(40) }, ...publishedChanges };
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.endsWith("/commits/main")) return Response.json({ sha: "a".repeat(40) });
    if (url.includes("/contents/")) {
      const name = Object.keys(SOURCES).find(name => url.includes(SOURCES[name] + "?"));
      assert.ok(url.endsWith(`?ref=${"a".repeat(40)}`));
      return Response.json({ type: "file", sha: blobs[name] });
    }
    if (url.includes("raw.githubusercontent.com")) {
      assert.ok(url.includes(`/${"a".repeat(40)}/`));
      const name = Object.keys(SOURCES).find(name => url.endsWith(SOURCES[name]));
      return new Response(corrupt ? "corrupted data" : files[name]);
    }
    return Response.json(published, { status });
  };
  return { root, calls, files, blobs, options: { root, request, siteCommit, skipUnchanged: true, token: undefined } };
}

test("unchanged published files skip downloads and deployment despite a newer upstream commit", async t => {
  const f = await fixture(t);
  const result = await fetchUpstream(f.options);
  assert.equal(result.deploy, false);
  assert.equal(f.calls.length, 5);
  await assert.rejects(readFile(new URL(".cache/upstream-source.json", f.root)), { code: "ENOENT" });
});

test("one changed input downloads only that file and records all deployed blob identities", async t => {
  const f = await fixture(t, { changed: ["kautian.csv"], publishedChanges: { source: {} } });
  const result = await fetchUpstream(f.options);
  assert.equal(result.deploy, true);
  assert.equal(result.downloaded, 1);
  assert.equal(f.calls.filter(url => url.includes("raw.githubusercontent.com")).length, 1);
  assert.deepEqual(await readFile(new URL("extension/kautian.csv", f.root)), f.files["kautian.csv"]);
  const source = JSON.parse(await readFile(new URL(".cache/upstream-source.json", f.root)));
  assert.deepEqual(source.blobs, f.blobs);
  assert.equal(source.siteCommit, f.options.siteCommit);
});

test("changed site code deploys even when all three data files are unchanged", async t => {
  const f = await fixture(t);
  const result = await fetchUpstream({ ...f.options, siteCommit: "d".repeat(40) });
  assert.equal(result.deploy, true);
  assert.equal(result.downloaded, 0);
});

test("push and manual runs build even when the scheduled check would skip", async t => {
  const f = await fixture(t);
  assert.equal((await fetchUpstream({ ...f.options, skipUnchanged: false })).deploy, true);
  assert.equal(f.calls.length, 4);
});

test("missing first-deployment descriptor builds using matching local files", async t => {
  const f = await fixture(t, { status: 404 });
  const result = await fetchUpstream(f.options);
  assert.equal(result.deploy, true);
  assert.equal(result.downloaded, 0);
});

test("a failed deployment leaves old published identities and is retried next time", async t => {
  const f = await fixture(t, { publishedChanges: { source: {} } });
  assert.equal((await fetchUpstream(f.options)).deploy, true);
  assert.equal((await fetchUpstream(f.options)).deploy, true);
});

test("published endpoint errors fail the check instead of silently deploying", async t => {
  const f = await fixture(t, { status: 503 });
  await assert.rejects(fetchUpstream(f.options), /Published dictionary check failed: HTTP 503/);
});

test("corrupted source download does not replace existing inputs or publication metadata", async t => {
  const f = await fixture(t, { changed: ["kautian.csv"], corrupt: true, publishedChanges: { source: {} } });
  await assert.rejects(fetchUpstream(f.options), /blob integrity check failed/);
  assert.equal(await readFile(new URL("extension/kautian.csv", f.root), "utf8"), "old data");
  await assert.rejects(readFile(new URL(".cache/upstream-source.json", f.root)), { code: "ENOENT" });
});
