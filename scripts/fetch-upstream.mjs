import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Compares upstream blob identities with the published snapshot before downloading build inputs.
const REPOSITORY = "taigikeyboard/taigikeyboard";
export const SOURCES = {
  "kautian.csv": "dictionary/sources/official/kautian/data/kautian.csv",
  "kautian.ods": "dictionary/sources/official/kautian/data/raw/kautian.ods",
  "word_unigrams.tsv": "dictionary/shared/data/word_unigrams.tsv",
};
const UPDATE_URL = "https://taigikeyboard.tw/kautian-mirror/data/v6/latest.json";

export function gitBlobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export async function fetchUpstream({
  root = new URL("../", import.meta.url), request = fetch,
  token = process.env.GH_TOKEN, siteCommit = process.env.GITHUB_SHA,
  skipUnchanged = process.env.SKIP_UNCHANGED === "true",
} = {}) {
  async function api(path) {
    const response = await request(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
      headers: { Accept: "application/vnd.github.object+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Upstream metadata request failed: HTTP ${response.status}`);
    return response.json();
  }
  const { sha } = await api("commits/main");
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid upstream commit");
  const entries = await Promise.all(Object.entries(SOURCES).map(async ([name, path]) => {
    const metadata = await api(`contents/${path}?ref=${sha}`);
    if (metadata.type !== "file" || !/^[a-f0-9]{40}$/.test(metadata.sha)) {
      throw new Error(`Invalid upstream file identity: ${name}`);
    }
    return [name, metadata.sha];
  }));
  const blobs = Object.fromEntries(entries);
  if (skipUnchanged) {
    const response = await request(UPDATE_URL, {
      cache: "no-cache", signal: AbortSignal.timeout(30000),
    });
    // A missing descriptor is the first deployment; other failures must not hide a failed check.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Published dictionary check failed: HTTP ${response.status}`);
    }
    const published = response.ok ? await response.json() : null;
    if (siteCommit && published?.source?.siteCommit === siteCommit && published.format === 6 &&
        entries.every(([name, blob]) => published.source.blobs?.[name] === blob)) {
      return { deploy: false, downloaded: 0, commit: sha };
    }
  }
  // Reuse identical checked-out inputs; complete and verify every download before replacing files.
  const files = await Promise.all(entries.map(async ([name, blob]) => {
    const target = new URL(`extension/${name}`, root);
    try {
      if (gitBlobSha(await readFile(target)) === blob) return null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const response = await request(`https://raw.githubusercontent.com/${REPOSITORY}/${sha}/${SOURCES[name]}`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (gitBlobSha(bytes) !== blob) throw new Error(`${name}: upstream blob integrity check failed`);
    return { target, bytes };
  }));
  for (const file of files.filter(Boolean)) await writeFile(file.target, file.bytes);
  await mkdir(new URL(".cache/", root), { recursive: true });
  await writeFile(new URL(".cache/upstream-source.json", root), JSON.stringify({
    repository: REPOSITORY, commit: sha, blobs, siteCommit: siteCommit || null,
  }));
  return { deploy: true, downloaded: files.filter(Boolean).length, commit: sha };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await fetchUpstream();
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `deploy=${result.deploy}\n`);
  }
  console.log(result.deploy
    ? `Upstream ${result.commit}: downloaded ${result.downloaded} changed files; build required`
    : `Upstream ${result.commit}: published inputs and site code unchanged; skipping deployment`);
}
