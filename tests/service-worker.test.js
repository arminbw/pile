import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { createBrowserMock } from './mocks/browser.js';

// Each test gets a clean module + clean browser mock.
// vi.resetModules() is required because service-worker.js has module-level state
// (cachedFolderId) and registers its onMessage listener on import — without a reset,
// state from one test would bleed into the next.
let browser;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers(); // prevents showBadge's setTimeout from leaking between tests
  browser = createBrowserMock();
  global.browser = browser;
  await import('../src/service-worker.js');
});

afterEach(() => {
  vi.useRealTimers(); // restore real timers so other test files aren't affected
});

// Delivers a message through the mock exactly as Firefox would — the service worker's
// onMessage listener receives it and returns a Promise with the response.
function sendMessage(msg) {
  return browser.runtime.sendMessage(msg);
}


describe('GET_BOOKMARKS_AND_FOLDERID', () => {
  test('creates the Pile folder when none exists', async () => {
    await sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });

    const folders = await browser.bookmarks.search({ title: 'Pile' });
    expect(folders).toHaveLength(1);
    expect(folders[0].type).toBe('folder');
  });

  test('does not create multiple Pile folders', async () => {
    // seed() plants a folder without firing events, simulating a pre-existing bookmark.
    browser.seed({ title: 'Pile', type: 'folder' });

    await sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });
    await sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });

    const folders = await browser.bookmarks.search({ title: 'Pile' });
    expect(folders).toHaveLength(1);
  });

  test('returns the bookmarks inside the Pile folder', async () => {
    const folder = browser.seed({ title: 'Pile', type: 'folder' });
    browser.seed({ title: 'Page A', url: 'https://a.com', parentId: folder.id });
    browser.seed({ title: 'Page B', url: 'https://b.com', parentId: folder.id });

    const response = await sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });

    expect(response.bookmarks).toHaveLength(2);
    expect(response.folderId).toBe(folder.id);
  });
});


describe('Pile folder removal', () => {
  test('invalidates the cached folder id so the next call recreates it', async () => {
    // First call populates the cache inside the service worker module.
    await sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });
    const [original] = await browser.bookmarks.search({ title: 'Pile' });

    // Removing the folder fires onRemoved, which nullifies cachedFolderId.
    await browser.bookmarks.remove(original.id);

    // The next call should detect no folder and create a fresh one.
    const response = await sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });
    const folders = await browser.bookmarks.search({ title: 'Pile' });
    expect(folders).toHaveLength(1);
    expect(folders[0].id).not.toBe(original.id);
    expect(response.folderId).toBe(folders[0].id);
  });
});


describe('ADD_BOOKMARK', () => {
  test('creates a bookmark in the Pile folder', async () => {
    const response = await sendMessage({
      type: 'ADD_BOOKMARK',
      tab: { url: 'https://example.com', title: 'Example' },
    });

    expect(response.bookmark.url).toBe('https://example.com');
    expect(response.bookmark.title).toBe('Example');
  });

  test('moves an existing bookmark to the top when the URL already exists', async () => {
    const folder = browser.seed({ title: 'Pile', type: 'folder' });
    browser.seed({ title: 'Old Title', url: 'https://example.com', parentId: folder.id });
    browser.seed({ title: 'Other Page', url: 'https://other.com', parentId: folder.id });

    await sendMessage({
      type: 'ADD_BOOKMARK',
      tab: { url: 'https://example.com', title: 'New Title' },
    });

    // Verify via GET that the duplicate was removed and the URL is now first.
    const response = await sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });
    expect(response.bookmarks).toHaveLength(2);
    expect(response.bookmarks[0].url).toBe('https://example.com');
  });

  test('rejects about:blank', async () => {
    await expect(
      sendMessage({ type: 'ADD_BOOKMARK', tab: { url: 'about:blank', title: '' } })
    ).rejects.toThrow();
  });
});
