// @vitest-environment jsdom
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, test, expect, vi } from 'vitest';
import { createBrowserMock } from './mocks/browser.js';

const panelHTML = readFileSync(resolve('src/sidebar/panel.html'), 'utf-8');

let browser;

function setupDOM() {
  document.documentElement.innerHTML = panelHTML;
}

// panel.js calls init() on import but doesn't await it.
// This flushes all pending microtasks so init() fully completes before we assert.
function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function initModules() {
  // service-worker must come first — panel's init() sends GET_BOOKMARKS_AND_FOLDERID
  // immediately, so the onMessage listener must already be registered
  await import('../src/service-worker.js');
  await import('../src/sidebar/panel.js');
  await flushPromises();
}

beforeEach(() => {
  vi.resetModules();
  browser = createBrowserMock();
  global.browser = browser;
  setupDOM();
});


test('renders existing bookmarks on init', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });
  browser.seed({ title: 'Page B', url: 'https://b.com', parentId: folder.id });

  await initModules();

  const items = document.querySelectorAll('li.bookmark');
  expect(items).toHaveLength(2);
  expect(items[0].dataset.url).toBe('https://a.com');
  expect(items[1].dataset.url).toBe('https://b.com');
});

test('adding a bookmark updates the DOM', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  browser.seed({ title: 'Existing', url: 'https://existing.com', parentId: folder.id });

  await initModules();

  await browser.runtime.sendMessage({
    type: 'ADD_BOOKMARK',
    tab: { url: 'https://new.com', title: 'New Page' },
  });

  const items = document.querySelectorAll('li.bookmark');
  expect(items).toHaveLength(2);
  expect(items[0].dataset.url).toBe('https://new.com');
});

test('removing a bookmark updates the DOM', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  const bookmark = browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });

  await initModules();

  await browser.bookmarks.remove(bookmark.id);

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(0);
});


// more complex multi-operation tests

test('re-adding an existing URL moves it to the top with the new title', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });
  browser.seed({ title: 'Page B', url: 'https://b.com', parentId: folder.id });
  browser.seed({ title: 'Page C', url: 'https://c.com', parentId: folder.id });

  await initModules();

  await browser.runtime.sendMessage({
    type: 'ADD_BOOKMARK',
    tab: { url: 'https://b.com', title: 'Page B Updated' },
  });

  const items = document.querySelectorAll('li.bookmark');
  expect(items).toHaveLength(3);
  expect(items[0].dataset.url).toBe('https://b.com');
  expect(items[0].querySelector('.link').textContent).toBe('Page B Updated');
  expect(items[1].dataset.url).toBe('https://a.com');
  expect(items[2].dataset.url).toBe('https://c.com');
});

test('multiple sequential adds stack in reverse order', async () => {
  await initModules();

  await browser.runtime.sendMessage({ type: 'ADD_BOOKMARK', tab: { url: 'https://1.com', title: 'Page 1' } });
  await browser.runtime.sendMessage({ type: 'ADD_BOOKMARK', tab: { url: 'https://2.com', title: 'Page 2' } });
  await browser.runtime.sendMessage({ type: 'ADD_BOOKMARK', tab: { url: 'https://3.com', title: 'Page 3' } });

  const items = document.querySelectorAll('li.bookmark');
  expect(items).toHaveLength(3);
  expect(items[0].dataset.url).toBe('https://3.com');
  expect(items[1].dataset.url).toBe('https://2.com');
  expect(items[2].dataset.url).toBe('https://1.com');
});

test('mix of removes and adds leaves the correct bookmarks in order', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  const pageA = browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });
  const pageB = browser.seed({ title: 'Page B', url: 'https://b.com', parentId: folder.id });
  browser.seed({ title: 'Page C', url: 'https://c.com', parentId: folder.id });

  await initModules();

  await browser.bookmarks.remove(pageB.id);
  await browser.runtime.sendMessage({ type: 'ADD_BOOKMARK', tab: { url: 'https://d.com', title: 'Page D' } });
  await browser.bookmarks.remove(pageA.id);

  const items = document.querySelectorAll('li.bookmark');
  expect(items).toHaveLength(2);
  expect(items[0].dataset.url).toBe('https://d.com');
  expect(items[1].dataset.url).toBe('https://c.com');
});

test('editing a bookmark title updates it in place without reordering', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  const pageA = browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });
  const pageB = browser.seed({ title: 'Page B', url: 'https://b.com', parentId: folder.id });

  await initModules();

  browser.bookmarks.onChanged.trigger(pageB.id, { title: 'Updated Title' });

  const items = document.querySelectorAll('li.bookmark');
  expect(items[0].querySelector('.link').textContent).toBe('Page A');
  expect(items[1].querySelector('.link').textContent).toBe('Updated Title');
  expect(items[1].dataset.title).toBe('updated title'); // used by search
});

test('moving a bookmark to the top reorders the list', async () => {
  const folder = browser.seed({ title: 'Pile', type: 'folder' });
  browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });
  browser.seed({ title: 'Page B', url: 'https://b.com', parentId: folder.id });
  const pageC = browser.seed({ title: 'Page C', url: 'https://c.com', parentId: folder.id });

  await initModules();

  browser.bookmarks.onMoved.trigger(pageC.id, {
    parentId: folder.id,
    oldParentId: folder.id,
    index: 0,
    oldIndex: 2,
  });
  await flushPromises();

  const items = document.querySelectorAll('li.bookmark');
  expect(items[0].dataset.url).toBe('https://c.com');
  expect(items[1].dataset.url).toBe('https://a.com');
  expect(items[2].dataset.url).toBe('https://b.com');
});


test('handles 100 adds, 50 removes and 10 moves within performance bounds', async () => {
  await initModules();

  // The service worker created the pile folder during init — grab its id for onMoved triggers
  const [pileFolder] = await browser.bookmarks.search({ title: 'Pile' });

  const start = performance.now();

  // 100 adds
  for (let i = 1; i <= 100; i++) {
    await browser.runtime.sendMessage({
      type: 'ADD_BOOKMARK',
      tab: { url: `https://page-${i}.com`, title: `Page ${i}` },
    });
  }

  // 50 removes — snapshot the list first so DOM mutations mid-loop don't affect iteration
  const snapshot = [...document.querySelectorAll('li.bookmark')];
  for (let i = 0; i < snapshot.length; i += 2) {
    await browser.bookmarks.remove(snapshot[i].dataset.bookmarkid);
  }

  // 10 moves — take the last 10 remaining items and move each to the top
  const afterRemoves = [...document.querySelectorAll('li.bookmark')];
  for (let i = 0; i < 10; i++) {
    const item = afterRemoves[afterRemoves.length - 1 - i];
    browser.bookmarks.onMoved.trigger(item.dataset.bookmarkid, {
      parentId: pileFolder.id,
      oldParentId: pileFolder.id,
      index: 0,
      oldIndex: afterRemoves.length - 1 - i,
    });
  }
  await flushPromises();

  const elapsed = performance.now() - start;

  const { messages, bookmarks: bm } = browser.stats;

  expect(document.querySelectorAll('li.bookmark')).toHaveLength(50);
  console.log(`160 operations in ${elapsed.toFixed(1)}ms`);
  console.log(`  messages:          ${messages}`);
  console.log(`  bookmarks.create:  ${bm.create}`);
  console.log(`  bookmarks.remove:  ${bm.remove}`);
  console.log(`  bookmarks.search:  ${bm.search}`);
  console.log(`  bookmarks.get:     ${bm.get}`);
  console.log(`  bookmarks.getSubTree: ${bm.getSubTree}`);
  expect(elapsed).toBeLessThan(2000);
});
