import { beforeEach, describe, test, expect, vi } from 'vitest';
import { createBrowserMock } from './mocks/browser.js';

// Each test gets a clean module + clean browser mock.
// We need vi.resetModules() because service-worker.js has module-level state
// (cachedFolderId) and registers its onMessage listener on import.
let browser;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers(); // prevents showBadge's setTimeout from leaking between tests
  browser = createBrowserMock();
  global.browser = browser;
  await import('../src/service-worker.js');
});

// Helper: trigger the onMessage handler the same way Firefox would
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
