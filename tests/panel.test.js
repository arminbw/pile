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
