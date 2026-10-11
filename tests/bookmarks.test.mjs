// 收藏 store: toggle order, persistence, and tolerance of malformed stored rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookmarkOf, createBookmarks } from "../src/bookmarks.js";

// chrome.storage-shaped stand-in for main.js's localStorage adapter
function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get(defaults, callback) {
      callback(Object.fromEntries(Object.keys(defaults).map((key) => [key, data[key] ?? defaults[key]])));
    },
    set(items) {
      Object.assign(data, items);
    },
  };
}

const well = { id: 567, hanzi: "井", tl: ["tsénn", "tsínn"] };
const one = { id: 1, hanzi: "一", tl: ["tsi̍t"] };

test("bookmarkOf_entry_keepsIdHanziAndSlashJoinedReadings", () => {
  assert.deepEqual(bookmarkOf(well), { id: 567, hanzi: "井", tl: "tsénn/tsínn" });
});

test("toggle_addsNewestFirstThenRemoves_andPersists", () => {
  const area = memoryArea();
  let changes = 0;
  const bookmarks = createBookmarks(area, () => changes++);
  assert.equal(bookmarks.toggle(well), true);
  assert.equal(bookmarks.toggle(one), true);
  assert.deepEqual(bookmarks.list().map((item) => item.id), [1, 567]);
  assert.equal(bookmarks.has(567), true);
  assert.equal(bookmarks.toggle(well), false);
  assert.equal(bookmarks.has(567), false);
  assert.deepEqual(area.data.bookmarks, [{ id: 1, hanzi: "一", tl: "tsi̍t" }]);
  assert.equal(changes, 3);
});

test("createBookmarks_storedRows_loadedAndMalformedOnesDropped", () => {
  const area = memoryArea({
    bookmarks: [{ id: 1, hanzi: "一", tl: "tsi̍t" }, { id: "2", hanzi: "二", tl: "nn̄g" }, null, { id: 3 }],
  });
  assert.deepEqual(createBookmarks(area).list(), [{ id: 1, hanzi: "一", tl: "tsi̍t" }]);
  assert.deepEqual(createBookmarks(memoryArea({ bookmarks: "junk" })).list(), []);
});
