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

// .click() always synthesizes button:0 with no modifiers, so modifier/non-primary clicks
// need a manually dispatched MouseEvent instead.
function clickLink(selector, options = {}) {
  document.querySelector(selector).dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options })
  );
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

test('sessions disabled in settings leaves no shading or dividers', async () => {
  await browser.storage.local.set({ 'pile-session-enabled': false });
  await initPanel(SESSIONED);
  const items = [...document.querySelectorAll('li.bookmark')];
  expect(items.some(li => li.classList.contains('session-b'))).toBe(false);
  expect(items.some(li => li.classList.contains('session-end'))).toBe(false);
});

test('a larger configured session gap merges everything into one session', async () => {
  await browser.storage.local.set({ 'pile-session-gap-hours': 72 }); // SESSIONED gaps are ~2 days
  await initPanel(SESSIONED);
  const shaded = [...document.querySelectorAll('li.bookmark')]
    .map(li => li.classList.contains('session-b'));
  expect(shaded.every(s => s === false)).toBe(true);
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


// --- tab tracking: clicking a bookmark ---

test('clicking an untracked bookmark opens it in a new foreground tab and marks it open', async () => {
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  const tabs = await browser.tabs.query({});
  expect(tabs).toHaveLength(1);
  expect(tabs[0].url).toBe('https://a.com');
  expect(tabs[0].active).toBe(true);
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(true);
});

test('with "open in new tab" off, clicking an untracked bookmark replaces the active tab instead', async () => {
  await browser.storage.local.set({ 'pile-open-in-new-tab': false });
  browser.seedTab({ url: 'https://current.com', active: true });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  const tabs = await browser.tabs.query({});
  expect(tabs).toHaveLength(1); // no new tab created — the seeded active tab was reused
  expect(tabs[0].url).toBe('https://a.com');
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(true);
});

test('clicking an already-open bookmark focuses its tab and window instead of opening a new one', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  const [tab] = await browser.tabs.query({});
  await browser.tabs.update(tab.id, { active: false });

  const updateWindowSpy = vi.fn(browser.windows.update);
  browser.windows.update = updateWindowSpy;

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  expect(updateWindowSpy).toHaveBeenCalledWith(tab.windowId, { focused: true });
  const tabsAfter = await browser.tabs.query({});
  expect(tabsAfter).toHaveLength(1); // still just the one tab
  expect(tabsAfter[0].active).toBe(true);
});

test('clicking two different untracked bookmarks opens two separate tabs, both tracked independently', async () => {
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  clickLink('li.bookmark[data-bookmarkid="2"] .link');
  await flushPromises();

  expect(await browser.tabs.query({})).toHaveLength(2);
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(true);
  expect(document.querySelector('li.bookmark[data-bookmarkid="2"]').classList.contains('is-open')).toBe(true);
});

test('with "open in new tab" off, clicking a second bookmark from the same tab untracks the first', async () => {
  await browser.storage.local.set({ 'pile-open-in-new-tab': false });
  browser.seedTab({ url: 'https://current.com', active: true });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(true);

  clickLink('li.bookmark[data-bookmarkid="2"] .link');
  await flushPromises();

  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(false);
  expect(document.querySelector('li.bookmark[data-bookmarkid="2"]').classList.contains('is-open')).toBe(true);
  expect(await browser.tabs.query({})).toHaveLength(1); // same tab reused both times
});

test('toggling the new-tab setting live changes behavior on the next click', async () => {
  await initPanel();
  browser.seedTab({ url: 'https://current.com', active: true });

  await browser.storage.local.set({ 'pile-open-in-new-tab': false });
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  const tabs = await browser.tabs.query({});
  expect(tabs).toHaveLength(1); // the pre-existing active tab was reused, no new tab created
  expect(tabs[0].url).toBe('https://a.com');
});

test('jumping to a tracked bookmark in a minimized window restores it', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  const [tab] = await browser.tabs.query({});
  await browser.windows.update(tab.windowId, { state: 'minimized' });

  const updateWindowSpy = vi.fn(browser.windows.update);
  browser.windows.update = updateWindowSpy;

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  expect(updateWindowSpy).toHaveBeenCalledWith(tab.windowId, { focused: true, state: 'normal' });
});

test('jumping to a tracked bookmark in a normal window does not touch window state', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  const [tab] = await browser.tabs.query({});

  const updateWindowSpy = vi.fn(browser.windows.update);
  browser.windows.update = updateWindowSpy;

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  expect(updateWindowSpy).toHaveBeenCalledWith(tab.windowId, { focused: true });
});

test('ctrl-click on a bookmark does not intercept or track it', async () => {
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link', { ctrlKey: true });
  await flushPromises();

  expect(await browser.tabs.query({})).toHaveLength(0);
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(false);
});

test('a non-primary-button click does not intercept', async () => {
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link', { button: 1 });
  await flushPromises();

  expect(await browser.tabs.query({})).toHaveLength(0);
});

test('the open-indicator element carries the i18n tooltip', async () => {
  await initPanel();

  const indicator = document.querySelector('li.bookmark[data-bookmarkid="1"] .open-indicator');
  expect(indicator).not.toBeNull();
  expect(indicator.title).toBe('openInTab');
});


// --- tab tracking: liveness ---

test('closing a tracked tab clears its open indicator', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  const [tab] = await browser.tabs.query({});

  await browser.tabs.remove(tab.id);

  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(false);
});

test('dragging a tracked tab to another window clears its open indicator', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  const [tab] = await browser.tabs.query({});

  await browser.tabs.onDetached.trigger(tab.id, { oldWindowId: tab.windowId, oldPosition: 0 });

  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(false);
});

test('navigating a tracked tab to a different URL clears its open indicator', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  const [tab] = await browser.tabs.query({});

  await browser.tabs.update(tab.id, { url: 'https://elsewhere.com' });

  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(false);
});

test('navigating within the same page (hash change) keeps the open indicator', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();
  const [tab] = await browser.tabs.query({});

  await browser.tabs.update(tab.id, { url: 'https://a.com/#section' });

  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(true);
});


// --- tab tracking: bookmark creation, removal, edit, move ---

test('bookmarking the active tab via the + button marks it open immediately (optimistic path)', async () => {
  await initPanel();
  browser.tabs.query = async () => [{ id: 99, windowId: 1, url: 'https://new.com', title: 'New Page', active: true }];

  click('[data-functionname="addbookmark"]');
  await flushPromises();

  const newLi = document.querySelector('li.bookmark[data-bookmarkid="new-id"]');
  expect(newLi.classList.contains('is-open')).toBe(true);
});

test('a bookmark created externally for the active tab is marked open (non-optimistic path)', async () => {
  await initPanel();
  browser.tabs.query = async () => [{ id: 42, windowId: 1, url: 'https://external.com', title: 'External', active: true }];

  await browser.bookmarks.onCreated.trigger('ext-id', { id: 'ext-id', url: 'https://external.com', title: 'External', parentId: FOLDER_ID });
  await flushPromises();

  const newLi = document.querySelector('li.bookmark[data-bookmarkid="ext-id"]');
  expect(newLi).not.toBeNull();
  expect(newLi.classList.contains('is-open')).toBe(true);
});

test('changing a tracked bookmark\'s URL clears its open indicator', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  await browser.bookmarks.onChanged.trigger('1', { url: 'https://changed.com' });

  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(false);
});

test('removing the entire Pile folder clears the list including any open indicators', async () => {
  await initPanel();
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  await browser.bookmarks.onRemoved.trigger(FOLDER_ID, {});

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(0);
});

test('moving a tracked bookmark out of the Pile folder clears its open indicator, even after moving back in', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  const otherFolder = browser.seed({ title: 'Other' });
  const bookmark = browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });

  browser.runtime.sendMessage = async (msg) => {
    if (msg.type === 'GET_BOOKMARKS_AND_FOLDERID') {
      const tree = await browser.bookmarks.getSubTree(folder.id);
      return { bookmarks: tree[0].children ?? [], folderId: folder.id };
    }
  };
  await import('../src/sidebar/panel.js');
  await flushPromises();

  clickLink(`li.bookmark[data-bookmarkid="${bookmark.id}"] .link`);
  await flushPromises();
  expect(document.querySelector(`li.bookmark[data-bookmarkid="${bookmark.id}"]`).classList.contains('is-open')).toBe(true);

  await browser.bookmarks.onMoved.trigger(bookmark.id, { parentId: otherFolder.id, oldParentId: folder.id, index: 0, oldIndex: 0 });
  expect(document.querySelector(`li.bookmark[data-bookmarkid="${bookmark.id}"]`)).toBeNull();

  await browser.bookmarks.onMoved.trigger(bookmark.id, { parentId: folder.id, oldParentId: otherFolder.id, index: 0, oldIndex: 0 });

  const restored = document.querySelector(`li.bookmark[data-bookmarkid="${bookmark.id}"]`);
  expect(restored).not.toBeNull();
  expect(restored.classList.contains('is-open')).toBe(false);
});


// --- tab tracking: startup seeding ---

test('a bookmark whose URL is already open in this window is marked open on init', async () => {
  browser.seedTab({ url: 'https://b.com', windowId: 1 });
  await initPanel();

  expect(document.querySelector('li.bookmark[data-bookmarkid="2"]').classList.contains('is-open')).toBe(true);
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('is-open')).toBe(false);
});

test('a tab in a different window is not considered open on init', async () => {
  browser.seedTab({ url: 'https://b.com', windowId: 99 });
  await initPanel();

  expect(document.querySelector('li.bookmark[data-bookmarkid="2"]').classList.contains('is-open')).toBe(false);
});

test('duplicate open tabs for the same URL still result in exactly one tracked match, no crash', async () => {
  browser.seedTab({ id: 501, url: 'https://b.com', windowId: 1 });
  browser.seedTab({ id: 502, url: 'https://b.com', windowId: 1 });
  await initPanel();

  expect(document.querySelector('li.bookmark[data-bookmarkid="2"]').classList.contains('is-open')).toBe(true);
});
