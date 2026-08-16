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

// Regression test for a real crash: on a brand-new profile, getBookmarkFolderId()
// has to create the Pile folder first, which widens the window between the click
// listener being registered and fullRebuild() actually populating the list. A click
// on "Add Page" landing inside that window used to find the list's raw HTML content
// (a whitespace text node before the first element) still in place. addBookmark()
// read that via .firstChild, which has no .dataset, and threw. This test recreates
// the same shape of DOM directly, decoupled from the exact whitespace in panel.html
// (which could drift), to pin the .firstElementChild fix itself.
test('clicking add when the list starts with a stray non-element node does not crash', async () => {
  await initPanel([]);
  document.querySelector('ul.bookmarks').prepend(document.createTextNode('\n  '));
  browser.tabs.query = async () => [{ url: 'https://new.com', title: 'New Page' }];

  click('[data-functionname="addbookmark"]');
  await flushPromises();

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(1);
  expect(document.querySelector('li.bookmark .link').textContent).toBe('New Page');
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
// The alternation is anchored at the BOTTOM: the oldest qualifying session keeps the
// default shade and the flips walk upward, so new sessions at the top never recolor
// existing blocks.
// Expected shading (session-b = the alternate grey):
//   session 1 (idx 0,1)  → default      (flipped again)
//   session 2 (idx 2,3)  → session-b    (flipped once)
//   lone save (idx 4)    → default      (absorbed into the block below, no flip)
//   session 3 (idx 5,6)  → default      (oldest block anchors the default shade)
// Expected session-end (darker divider on the bottom row of each shaded block; the
// absorbed lone save at idx 4 belongs to the bottom block, so the session-b block
// ends at idx 3):
//   idx 1, 3, 6
const SESSIONED = [
  { id: '1', title: 'A1', url: 'https://a1.com', parentId: FOLDER_ID, dateAdded: T },
  { id: '2', title: 'A2', url: 'https://a2.com', parentId: FOLDER_ID, dateAdded: T - 60_000 },
  { id: '3', title: 'B1', url: 'https://b1.com', parentId: FOLDER_ID, dateAdded: T - 2 * DAY },
  { id: '4', title: 'B2', url: 'https://b2.com', parentId: FOLDER_ID, dateAdded: T - 2 * DAY - 60_000 },
  { id: '5', title: 'L',  url: 'https://l.com',  parentId: FOLDER_ID, dateAdded: T - 4 * DAY },
  { id: '6', title: 'C1', url: 'https://c1.com', parentId: FOLDER_ID, dateAdded: T - 6 * DAY },
  { id: '7', title: 'C2', url: 'https://c2.com', parentId: FOLDER_ID, dateAdded: T - 6 * DAY - 60_000 },
];

test('alternating sessions shade with isolated saves absorbed into the block below', async () => {
  await initPanel(SESSIONED);
  const shaded = [...document.querySelectorAll('li.bookmark')]
    .map(li => li.classList.contains('session-b'));
  expect(shaded).toEqual([false, false, true, true, false, false, false]);
});

test('the last bookmark of each session is marked session-end', async () => {
  await initPanel(SESSIONED);
  const ends = [...document.querySelectorAll('li.bookmark')]
    .map(li => li.classList.contains('session-end'));
  expect(ends).toEqual([false, true, false, true, false, false, true]);
});

// Guards the anchor choice itself: a brand-new session appearing at the top must take
// the next shade in the sequence while every block the user already knows keeps its
// color. (Anchored at the top instead, a new session would recolor everything below.)
test('a new session on top leaves the shades of all existing blocks unchanged', async () => {
  const NEW_SESSION = [
    { id: '8', title: 'N1', url: 'https://n1.com', parentId: FOLDER_ID, dateAdded: T + 2 * DAY },
    { id: '9', title: 'N2', url: 'https://n2.com', parentId: FOLDER_ID, dateAdded: T + 2 * DAY - 60_000 },
  ];
  await initPanel([...NEW_SESSION, ...SESSIONED]);
  const shaded = [...document.querySelectorAll('li.bookmark')]
    .map(li => li.classList.contains('session-b'));
  expect(shaded.slice(2)).toEqual([false, false, true, true, false, false, false]); // as in the fixture test
  expect(shaded.slice(0, 2)).toEqual([true, true]); // the newcomer takes the next shade
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


// --- opening bookmarks ---

test('clicking a bookmark that is not open anywhere opens it in a new foreground tab', async () => {
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  const tabs = await browser.tabs.query({});
  expect(tabs).toHaveLength(1);
  expect(tabs[0].url).toBe('https://a.com');
  expect(tabs[0].active).toBe(true);
});

test('with "open in active tab" on, clicking a bookmark replaces the active tab instead', async () => {
  await browser.storage.local.set({ 'pile-open-in-active-tab': true });
  browser.seedTab({ url: 'https://current.com', active: true });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  const tabs = await browser.tabs.query({});
  expect(tabs).toHaveLength(1); // no new tab created — the seeded active tab was reused
  expect(tabs[0].url).toBe('https://a.com');
});

test('toggling the active-tab setting live changes behavior on the next click', async () => {
  await initPanel();
  browser.seedTab({ url: 'https://current.com', active: true });

  await browser.storage.local.set({ 'pile-open-in-active-tab': true });
  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  const tabs = await browser.tabs.query({});
  expect(tabs).toHaveLength(1); // the pre-existing active tab was reused, no new tab created
  expect(tabs[0].url).toBe('https://a.com');
});

test('clicking a bookmark already open in this window focuses that tab instead of duplicating it', async () => {
  const open = browser.seedTab({ url: 'https://b.com', active: false });
  browser.seedTab({ url: 'https://current.com', active: true });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="2"] .link');
  await flushPromises();

  expect(browser.stats.tabs.create).toBe(0);
  expect((await browser.tabs.get(open.id)).active).toBe(true);
});

// With "open in active tab" on, the setting wins: the page loads in the active tab
// even if it is already open elsewhere. No duplicate check runs in this mode —
// reusing the active tab never adds a tab, and the user asked to stay put.
test('with "open in active tab" on, an already-open page still loads in the active tab', async () => {
  await browser.storage.local.set({ 'pile-open-in-active-tab': true });
  const open = browser.seedTab({ url: 'https://b.com', active: false });
  const active = browser.seedTab({ url: 'https://current.com', active: true });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="2"] .link');
  await flushPromises();

  expect((await browser.tabs.get(active.id)).url).toBe('https://b.com'); // loaded here
  expect((await browser.tabs.get(active.id)).active).toBe(true);         // focus stays put
  expect((await browser.tabs.get(open.id)).active).toBe(false);
  expect(browser.stats.tabs.create).toBe(0);
});

test('a tab in a different window is not treated as a match', async () => {
  browser.seedTab({ url: 'https://b.com', windowId: 99 });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="2"] .link');
  await flushPromises();

  expect(browser.stats.tabs.create).toBe(1); // opened here rather than jumping windows
});

test('duplicate open tabs for the same URL focus one of them without opening another', async () => {
  browser.seedTab({ id: 501, url: 'https://b.com' });
  browser.seedTab({ id: 502, url: 'https://b.com' });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="2"] .link');
  await flushPromises();

  expect(browser.stats.tabs.create).toBe(0);
  const active = (await browser.tabs.query({ active: true })).map(t => t.id);
  expect(active).toHaveLength(1);
  expect([501, 502]).toContain(active[0]);
});

test('a tab with no URL at all does not break matching', async () => {
  browser.seedTab({ url: undefined });
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  expect(browser.stats.tabs.create).toBe(1);
});


// --- URL matching ---
//
// normalizeUrl is internal to panel.js (loaded as a classic script, so nothing is exported),
// so both tables exercise it through the behaviour that depends on it: a match reuses the
// open tab, a non-match opens a new one.

test.each([
  ['identical',            'https://example.com/article', 'https://example.com/article'],
  ['trailing slash',       'https://example.com/article', 'https://example.com/article/'],
  ['slash before a query', 'https://example.com/article?page=2', 'https://example.com/article/?page=2'],
  ['fragment',             'https://example.com/article', 'https://example.com/article#part-2'],
  ['http vs https',        'http://example.com/article',  'https://example.com/article'],
  ['www prefix',           'https://example.com/article', 'https://www.example.com/article'],
  ['host casing',          'https://example.com/article', 'https://EXAMPLE.com/article'],
  ['utm params',           'https://example.com/article', 'https://example.com/article?utm_source=rss'],
  ['fbclid',               'https://example.com/article', 'https://example.com/article?fbclid=abc123'],
  ['query order',          'https://example.com/a?x=1&y=2', 'https://example.com/a?y=2&x=1'],
])('treats %s as the same page and reuses the open tab', async (_label, bookmarkUrl, tabUrl) => {
  const open = browser.seedTab({ url: tabUrl });
  await initPanel([{ id: '1', title: 'Page', url: bookmarkUrl, parentId: FOLDER_ID }]);

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  expect(browser.stats.tabs.create).toBe(0);
  expect((await browser.tabs.get(open.id)).active).toBe(true);
});

test.each([
  ['a different path',     'https://example.com/article', 'https://example.com/other'],
  ['a different host',     'https://example.com/article', 'https://example.org/article'],
  ['a subdomain',          'https://example.com/article', 'https://blog.example.com/article'],
  ['a meaningful param',   'https://example.com/a?page=1', 'https://example.com/a?page=2'],
  ['a missing param',      'https://example.com/a?page=1', 'https://example.com/a'],
])('treats %s as a different page and opens a new tab', async (_label, bookmarkUrl, tabUrl) => {
  browser.seedTab({ url: tabUrl });
  await initPanel([{ id: '1', title: 'Page', url: bookmarkUrl, parentId: FOLDER_ID }]);

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  expect(browser.stats.tabs.create).toBe(1);
});

// The normalized form is a comparison key only — what actually opens is the raw bookmark URL.
test('opens the bookmark URL verbatim rather than its normalized form', async () => {
  await initPanel([{ id: '1', title: 'Page', url: 'http://www.example.com/a/', parentId: FOLDER_ID }]);

  clickLink('li.bookmark[data-bookmarkid="1"] .link');
  await flushPromises();

  const [tab] = await browser.tabs.query({});
  expect(tab.url).toBe('http://www.example.com/a/');
});


// --- highlighted bookmarks ---

function simulateMenuClick(bookmarkId) {
  browser.menus.getTargetElement = () =>
    document.querySelector(`li.bookmark[data-bookmarkid="${bookmarkId}"] .link`);
  return browser.menus.onClicked.trigger({ menuItemId: 'toggle-highlight', targetElementId: 1 });
}

test('the menu action toggles the highlight and persists it', async () => {
  await initPanel();

  await simulateMenuClick('1');
  await flushPromises();
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('highlighted')).toBe(true);
  expect((await browser.storage.local.get('pile-highlighted'))['pile-highlighted']).toEqual(['1']);

  await simulateMenuClick('1');
  await flushPromises();
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('highlighted')).toBe(false);
  expect((await browser.storage.local.get('pile-highlighted'))['pile-highlighted']).toEqual([]);
});

test('stored highlights are applied on init', async () => {
  await browser.storage.local.set({ 'pile-highlighted': ['2'] });
  await initPanel();

  expect(document.querySelector('li.bookmark[data-bookmarkid="2"]').classList.contains('highlighted')).toBe(true);
  expect(document.querySelector('li.bookmark[data-bookmarkid="1"]').classList.contains('highlighted')).toBe(false);
});

test('ids of bookmarks that no longer exist are pruned from storage on init', async () => {
  await browser.storage.local.set({ 'pile-highlighted': ['2', 'long-gone'] });
  await initPanel();

  expect((await browser.storage.local.get('pile-highlighted'))['pile-highlighted']).toEqual(['2']);
});

test('removing a highlighted bookmark removes its stored id', async () => {
  await browser.storage.local.set({ 'pile-highlighted': ['1'] });
  await initPanel();

  await browser.bookmarks.onRemoved.trigger('1', { parentId: FOLDER_ID });
  await flushPromises();

  expect((await browser.storage.local.get('pile-highlighted'))['pile-highlighted']).toEqual([]);
});

test('a highlight made in one sidebar reaches another via storage', async () => {
  await initPanel();

  // another window's sidebar wrote a new highlight set
  await browser.storage.local.set({ 'pile-highlighted': ['3'] });
  await flushPromises();

  expect(document.querySelector('li.bookmark[data-bookmarkid="3"]').classList.contains('highlighted')).toBe(true);
});

// Regression test: the menus.onShown/onClicked registration for the highlight
// feature happens at module load, before init() runs at the bottom of the
// file. If that registration throws, it must not be able to take init() —
// and therefore bookmark rendering — down with it. This is deliberately not
// wrapped by initPanel(), since the failure would happen during the import
// that initPanel() performs.
test('bookmarks still render even if the menus API registration fails', async () => {
  browser.menus.onShown.addListener = () => { throw new Error('boom'); };
  await initPanel();

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(3);
});

test('right-click on a bookmark overrides the native menu, elsewhere it does not', async () => {
  await initPanel();
  const overrideSpy = vi.fn();
  browser.menus.overrideContext = overrideSpy;

  document.querySelector('li.bookmark[data-bookmarkid="1"] .link').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  );
  expect(overrideSpy).toHaveBeenCalledWith({ showDefaults: false });

  overrideSpy.mockClear();
  document.querySelector('ul.bookmarks').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  );
  expect(overrideSpy).not.toHaveBeenCalled();
});


// --- click interception ---

test('ctrl-click on a bookmark is left to the browser', async () => {
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link', { ctrlKey: true });
  await flushPromises();

  expect(await browser.tabs.query({})).toHaveLength(0);
});

test('a non-primary-button click does not intercept', async () => {
  await initPanel();

  clickLink('li.bookmark[data-bookmarkid="1"] .link', { button: 1 });
  await flushPromises();

  expect(await browser.tabs.query({})).toHaveLength(0);
});

