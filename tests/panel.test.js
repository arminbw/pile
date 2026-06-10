// @vitest-environment jsdom — runs this file in a browser-like DOM environment
// instead of plain Node, so document.querySelector and click() work.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, test, expect, vi } from 'vitest';
import { createBrowserMock } from './mocks/browser.js';

const panelHTML = readFileSync(resolve('src/sidebar/panel.html'), 'utf-8');

const FOLDER_ID = 'folder-1';
const BOOKMARKS = [
  { id: '1', title: 'Page A', url: 'https://a.com', parentId: FOLDER_ID },
  { id: '2', title: 'Page B', url: 'https://b.com', parentId: FOLDER_ID },
  { id: '3', title: 'Page C', url: 'https://c.com', parentId: FOLDER_ID },
];

let browser;

// panel.js calls init() on import but doesn't await it.
// This flushes all pending microtasks so init() fully completes before we assert.
function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Load panel.js with sendMessage stubbed out — no service worker is running.
// This lets us test UI behaviour in isolation without the full message-routing stack.
// ADD_BOOKMARK fires onCreated synchronously inside sendMessage, mirroring what
// the service worker would do in production so the panel can reconcile the optimistic element.
async function initPanel(bookmarks = BOOKMARKS) {
  browser.runtime.sendMessage = async (msg) => {
    if (msg.type === 'GET_BOOKMARKS_AND_FOLDERID')
      return { bookmarks, folderId: FOLDER_ID };
    if (msg.type === 'ADD_BOOKMARK') {
      const bookmark = { id: 'new-id', url: msg.tab.url, title: msg.tab.title, parentId: FOLDER_ID };
      browser.bookmarks.onCreated.trigger('new-id', bookmark);
      return { bookmark };
    }
  };
  await import('../src/sidebar/panel.js');
  await flushPromises();
}

function click(selector) {
  document.querySelector(selector).click();
}

beforeEach(() => {
  vi.resetModules(); // clears panel.js module state (pileFolderId, cleanupMode, etc.) between tests
  browser = createBrowserMock();
  global.browser = browser;
  document.documentElement.innerHTML = panelHTML;
});


// --- addBookmark ---

test('clicking add creates a new bookmark at the top', async () => {
  await initPanel();
  browser.tabs.query = async () => [{ url: 'https://new.com', title: 'New Page' }];

  click('[data-functionname="addbookmark"]');
  await flushPromises();

  const items = document.querySelectorAll('li.bookmark');
  expect(items).toHaveLength(4);
  expect(items[0].dataset.url).toBe('https://new.com');
  // data-bookmarkid starts as '' (optimistic) and is reconciled to 'new-id' via onCreated.
  expect(items[0].dataset.bookmarkid).toBe('new-id');
});

test('clicking add when the URL is already at the top does not create a duplicate', async () => {
  await initPanel();
  browser.tabs.query = async () => [{ url: 'https://a.com', title: 'Page A' }];

  click('[data-functionname="addbookmark"]');
  await flushPromises();

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(3);
});

test('optimistic element is removed when sendMessage fails', async () => {
  await initPanel([]);
  browser.tabs.query = async () => [{ url: 'https://new.com', title: 'New Page' }];
  browser.runtime.sendMessage = async (msg) => {
    if (msg.type === 'GET_BOOKMARKS_AND_FOLDERID') return { bookmarks: [], folderId: FOLDER_ID };
    if (msg.type === 'ADD_BOOKMARK') throw new Error('Connection failed');
  };

  click('[data-functionname="addbookmark"]');
  await flushPromises();

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(0);
});


// --- cleanup mode ---

test('entering cleanup mode adds the cleanup-mode class', async () => {
  await initPanel();

  click('[data-functionname="togglecleanup"]');

  expect(document.querySelector('#content').classList.contains('cleanup-mode')).toBe(true);
});

test('select all marks every bookmark as selected', async () => {
  await initPanel();
  click('[data-functionname="togglecleanup"]');

  click('[data-functionname="selectall"]');

  const selected = document.querySelectorAll('li.bookmark.selected');
  expect(selected).toHaveLength(3);
});

test('deleting selected bookmarks removes them from the DOM', async () => {
  await initPanel();
  click('[data-functionname="togglecleanup"]');
  click('[data-functionname="selectall"]');

  click('[data-functionname="deleteselected"]');

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(0);
  // stats.bookmarks.remove confirms the API was called for each deleted bookmark.
  expect(browser.stats.bookmarks.remove).toBe(3);
});

test('deleting only selected bookmarks leaves the rest intact', async () => {
  await initPanel();
  click('[data-functionname="togglecleanup"]');

  // select only the first bookmark
  document.querySelector('li.bookmark .cleanup-checkbox').click();

  click('[data-functionname="deleteselected"]');

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(2);
  expect(browser.stats.bookmarks.remove).toBe(1);
});

test('cancelling cleanup mode removes the cleanup-mode class', async () => {
  await initPanel();
  click('[data-functionname="togglecleanup"]');
  expect(document.querySelector('#content').classList.contains('cleanup-mode')).toBe(true);

  click('[data-functionname="cancelcleanup"]');

  expect(document.querySelector('#content').classList.contains('cleanup-mode')).toBe(false);
});


// --- browsing session shading ---

const DAY = 24 * 60 * 60 * 1000;
const T = 1_700_000_000_000; // arbitrary fixed "now", newest bookmark first

// Two sessions, then a lone save, then a third session. Between-session gaps are
// whole days so the fixture splits the same way regardless of the exact SESSION_GAP_MS
// threshold; within a session the saves are only a minute apart.
// Expected shading (session-b = the alternate grey):
//   session 1 (idx 0,1)  → default      (no class)
//   session 2 (idx 2,3)  → session-b
//   lone save (idx 4)    → session-b    (absorbed into the block above, no flip)
//   session 3 (idx 5,6)  → default      (flips back)
// Expected session-end (darker divider on the bottom row of each shaded block, so the
// absorbed lone save at idx 4 is the end of the session-b block, not idx 3):
//   idx 1, 4, 6
const SESSIONED = [
  { id: '1', title: 'A1', url: 'https://a1.com', parentId: FOLDER_ID, dateAdded: T },
  { id: '2', title: 'A2', url: 'https://a2.com', parentId: FOLDER_ID, dateAdded: T - 60_000 },
  { id: '3', title: 'B1', url: 'https://b1.com', parentId: FOLDER_ID, dateAdded: T - 2 * DAY },
  { id: '4', title: 'B2', url: 'https://b2.com', parentId: FOLDER_ID, dateAdded: T - 2 * DAY - 60_000 },
  { id: '5', title: 'L',  url: 'https://l.com',  parentId: FOLDER_ID, dateAdded: T - 4 * DAY },
  { id: '6', title: 'C1', url: 'https://c1.com', parentId: FOLDER_ID, dateAdded: T - 6 * DAY },
  { id: '7', title: 'C2', url: 'https://c2.com', parentId: FOLDER_ID, dateAdded: T - 6 * DAY - 60_000 },
];

test('alternating sessions shade with isolated saves absorbed into the block above', async () => {
  await initPanel(SESSIONED);
  const shaded = [...document.querySelectorAll('li.bookmark')]
    .map(li => li.classList.contains('session-b'));
  expect(shaded).toEqual([false, false, true, true, true, false, false]);
});

test('the last bookmark of each session is marked session-end', async () => {
  await initPanel(SESSIONED);
  const ends = [...document.querySelectorAll('li.bookmark')]
    .map(li => li.classList.contains('session-end'));
  expect(ends).toEqual([false, true, false, false, true, false, true]);
});

test('search flattens the session shading via is-filtered on the list', async () => {
  await initPanel(SESSIONED);
  const list = document.querySelector('ul.bookmarks');
  const input = document.querySelector('.search-input-field');

  input.value = 'b1';
  input.dispatchEvent(new Event('input'));
  expect(list.classList.contains('is-filtered')).toBe(true);

  input.value = '';
  input.dispatchEvent(new Event('input'));
  expect(list.classList.contains('is-filtered')).toBe(false);
});
