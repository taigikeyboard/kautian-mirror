// Published data layout shared by the build scripts and the browser app (paths relative to dist/).
export const INDEX_PATH = "data/kautian.min.json";
export const ENTRIES_DIR = "data/entries";
export const BUCKET_SIZE = 500;
export const bucketOf = (entryId) => Math.floor(entryId / BUCKET_SIZE);
export const shardPath = (bucket) => `${ENTRIES_DIR}/${bucket}.json`;
// word audio (詞目音檔): same {id/1000}/{id}.mp3 layout as the official site and MOE's zip
export const AUDIO_DIR = "audio";
export const AUDIO_BUCKET_SIZE = 1000;
export const audioBucketOf = (entryId) => Math.floor(entryId / AUDIO_BUCKET_SIZE);
export const audioPath = (entryId) => `${AUDIO_DIR}/${audioBucketOf(entryId)}/${entryId}.mp3`;
