// Published data layout shared by the build scripts and the browser app (paths relative to dist/).
export const INDEX_PATH = "data/kautian.min.json";
export const ENTRIES_DIR = "data/entries";
export const BUCKET_SIZE = 500;
export const bucketOf = (entryId) => Math.floor(entryId / BUCKET_SIZE);
export const shardPath = (bucket) => `${ENTRIES_DIR}/${bucket}.json`;
