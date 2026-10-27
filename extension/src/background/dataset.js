// Owns the validated local dataset and checks for compatible remote data daily.
export const DATA_FORMAT = 6;
export const UPDATE_URL = "https://taigikeyboard.tw/kautian-mirror/data/v6/latest.json";
const DAY = 24 * 60 * 60 * 1000;
// Match pages.yml: 01:00 UTC is 09:00 Asia/Taipei, independent of the device's timezone.
const DAILY_CHECK_OFFSET = 60 * 60 * 1000;
const COLUMNS = ["tl", "hanzi", "poj", "tps", "tlNum", "tpsNotoneVar", "abTl", "abPoj", "abTps", "gloss"];

export function validateDataset(data) {
  const count = data?.meta?.count;
  if (data?.meta?.format !== DATA_FORMAT || !Number.isInteger(count) || count <= 0) {
    throw new Error("Invalid dictionary format or row count");
  }
  for (const column of ["id", "flags", "pop"]) {
    if (!Array.isArray(data[column]) || data[column].length !== count ||
        !data[column].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error(`Invalid dictionary column: ${column}`);
    }
  }
  for (const column of COLUMNS) {
    if (typeof data[column] !== "string" || data[column].split("\n").length !== count) {
      throw new Error(`Invalid dictionary column: ${column}`);
    }
  }
  return data;
}

export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createDatasetStore({ read, write, fetchJson, fetchBytes, seedUrl, now = Date.now, warn = console.warn }) {
  let current;
  let loading;
  let updating;

  async function load() {
    try {
      const saved = await read();
      if (saved) {
        validateDataset(saved.data);
        if (!Number.isFinite(saved.checkedAt) || saved.checkedAt < 0 || saved.checkedAt > now() ||
            (saved.hash !== null && !/^[a-f0-9]{64}$/.test(saved.hash))) {
          throw new Error("Invalid cached dictionary metadata");
        }
        return saved;
      }
    } catch (error) {
      warn("dictionary.cache.invalid", error.message);
    }
    const data = validateDataset(await fetchJson(seedUrl));
    const hash = await sha256(new TextEncoder().encode(JSON.stringify(data)));
    const initial = { data, hash, checkedAt: 0 };
    await write(initial);
    return initial;
  }

  async function update() {
    const boundary = Math.floor((now() - DAILY_CHECK_OFFSET) / DAY) * DAY + DAILY_CHECK_OFFSET;
    if (current.checkedAt >= boundary) return;
    try {
      const descriptor = await fetchJson(UPDATE_URL);
      if (descriptor?.format !== DATA_FORMAT || !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
          descriptor.file !== `${descriptor.sha256}.json` ||
          !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 || descriptor.bytes > 16 * 1024 * 1024) {
        throw new Error("Invalid dictionary update descriptor");
      }
      let data = current.data;
      if (descriptor.sha256 !== current.hash) {
        const bytes = await fetchBytes(new URL(descriptor.file, UPDATE_URL).href);
        if (bytes.byteLength !== descriptor.bytes || await sha256(bytes) !== descriptor.sha256) {
          throw new Error("Dictionary update integrity check failed");
        }
        data = validateDataset(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      }
      const updated = { data, hash: descriptor.sha256, checkedAt: now() };
      await write(updated);
      current = updated;
    } catch (error) {
      // Keep the last validated data and throttle failures, too.
      const retained = { ...current, checkedAt: now() };
      try { await write(retained); current = retained; } catch { /* retry on next use */ }
      warn("dictionary.update.failed", error.message);
    }
  }

  return {
    async get() {
      loading ??= load().then((value) => { current = value; }).catch((error) => {
        loading = null;
        throw error;
      });
      await loading;
      return current.data;
    },
    async check() {
      await this.get();
      updating ??= update().finally(() => { updating = null; });
      await updating;
    },
  };
}
