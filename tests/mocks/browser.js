import { readFileSync } from 'fs';
import { resolve } from 'path';

// The real English messages, so tests can assert actual UI strings and the
// placeholder substitution is exercised the way Firefox performs it.
// Resolved from the project root, like the HTML fixtures in the test files.
const i18nMessages = JSON.parse(
  readFileSync(resolve('src/_locales/en/messages.json'), 'utf-8')
);

// Mirrors browser.i18n.getMessage: resolves the key in the en locale and fills
// $NAME$ placeholders from the substitutions ($1 = first substitution, ...).
// Unknown keys return the key itself (Firefox returns '', but the key makes
// broken lookups visible in test failures instead of silently blank).
function getMessage(key, substitutions = []) {
  const entry = i18nMessages[key];
  if (!entry) return key;
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  let message = entry.message;
  for (const [name, def] of Object.entries(entry.placeholders ?? {})) {
    const index = parseInt(def.content.slice(1), 10) - 1;
    message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), subs[index] ?? '');
  }
  return message;
}

export function createBrowserMock() {
  // Single in-memory bookmarkStore shared across all bookmark API methods.
  // Every entry is keyed by its string id and carries { id, parentId, index, title, url?, type? }.
  const bookmarkStore = new Map();
  let nextId = 1;

  // Single in-memory tabStore/windowStore shared across all tabs.*/windows.* methods.
  // Every tab carries { id, windowId, url, title, active }; every window carries { id, state }.
  const tabStore = new Map();
  const windowStore = new Map();
  let nextTabId = 1;
  const DEFAULT_WINDOW_ID = 1;
  windowStore.set(DEFAULT_WINDOW_ID, { id: DEFAULT_WINDOW_ID, state: 'normal' });

  // Counts every API call — read in tests to verify efficiency.
  const stats = {
    messages: 0,
    bookmarks: { create: 0, remove: 0, update: 0, get: 0, search: 0, getSubTree: 0 },
    tabs: { create: 0, update: 0 },
  };

  const messageListeners = [];
  const onCreatedListeners = [];
  const onRemovedListeners = [];
  const onChangedListeners = [];
  const onMovedListeners = [];
  const onStorageChangedListeners = [];
  const onMenuShownListeners = [];
  const onMenuClickedListeners = [];
  const storageData = {};

  // Returns an { addListener, trigger } pair so tests can both register listeners
  // (via addListener, same as production code) and fire them directly (via trigger).
  function makeEvent(listeners) {
    return {
      addListener: fn => listeners.push(fn),
      trigger: (...args) => Promise.all(listeners.map(fn => fn(...args))),
    };
  }

  // All direct children of parentId, unsorted.
  function siblingsOf(parentId) {
    return [...bookmarkStore.values()].filter(b => b.parentId === parentId);
  }

  // Add an entry to the bookmarkStore without firing any events — used in tests to set up
  // initial state before the module under test gets a chance to react.
  function seed(entry) {
    const id = String(nextId++);
    const index = siblingsOf(entry.parentId).length;
    const record = { id, index, ...entry };
    bookmarkStore.set(id, record);
    return record;
  }

  // Add a tab to the tabStore without firing any events — mirrors seed() for bookmarks.
  // windowId defaults to DEFAULT_WINDOW_ID, the same window windows.getCurrent() resolves to.
  function seedTab(entry) {
    const id = entry.id ?? nextTabId++;
    const windowId = entry.windowId ?? DEFAULT_WINDOW_ID;
    if (!windowStore.has(windowId)) windowStore.set(windowId, { id: windowId, state: 'normal' });
    const tab = { id, windowId, url: entry.url, title: entry.title ?? '', active: entry.active ?? false };
    tabStore.set(id, tab);
    return tab;
  }

  const mock = {
    seed,
    seedTab,
    stats,

    runtime: {
      id: 'pile-test-id',
      onInstalled: { addListener: () => {} },
      onMessage: makeEvent(messageListeners),
      // Delivers a message to all registered onMessage listeners, mirroring Firefox.
      // Passes sender.id so the service-worker's identity check (sender.id !== browser.runtime.id) passes.
      sendMessage: (msg) => {
        stats.messages++;
        for (const fn of messageListeners) {
          const result = fn(msg, { id: 'pile-test-id' });
          if (result !== undefined) return result;
        }
      },
    },

    bookmarks: {
      onCreated: makeEvent(onCreatedListeners),
      onRemoved: makeEvent(onRemovedListeners),

      onChanged: {
        addListener: fn => onChangedListeners.push(fn),
        // Also mutates the bookmarkStore so subsequent getSubTree calls reflect the change.
        trigger: (id, changeInfo) => {
          const item = bookmarkStore.get(id);
          if (item) Object.assign(item, changeInfo);
          onChangedListeners.forEach(fn => fn(id, changeInfo));
        },
      },

      onMoved: {
        addListener: fn => onMovedListeners.push(fn),
        // Reindexes siblings before firing listeners so the bookmarkStore stays consistent
        // with what getSubTree would return after a real Firefox move.
        trigger: (id, moveInfo) => {
          const item = bookmarkStore.get(id);
          if (item) {
            siblingsOf(moveInfo.oldParentId).forEach(b => { if (b.id !== id && b.index > moveInfo.oldIndex) b.index--; });
            siblingsOf(moveInfo.parentId).forEach(b => { if (b.id !== id && b.index >= moveInfo.index) b.index++; });
            item.parentId = moveInfo.parentId;
            item.index = moveInfo.index;
          }
          onMovedListeners.forEach(fn => fn(id, moveInfo));
        },
      },

      create: async ({ title, url, parentId, index, type } = {}) => {
        stats.bookmarks.create++;
        // If no index is given, append at the end; otherwise shift existing siblings to make room.
        const insertAt = index ?? siblingsOf(parentId).length;
        siblingsOf(parentId).forEach(b => { if (b.index >= insertAt) b.index++; });
        const id = String(nextId++);
        const bookmark = { id, title, url, parentId, index: insertAt, type: type ?? (url ? 'bookmark' : 'folder') };
        bookmarkStore.set(id, bookmark);
        onCreatedListeners.forEach(fn => fn(id, bookmark));
        return bookmark;
      },

      update: async (id, changes) => {
        stats.bookmarks.update++;
        const item = bookmarkStore.get(id);
        if (item) Object.assign(item, changes);
        return item;
      },

      remove: async (id) => {
        stats.bookmarks.remove++;
        const bookmark = bookmarkStore.get(id);
        if (!bookmark) return;
        bookmarkStore.delete(id);
        // Close the gap left by the removed item.
        siblingsOf(bookmark.parentId).forEach(b => { if (b.index > bookmark.index) b.index--; });
        onRemovedListeners.forEach(fn => fn(id, { parentId: bookmark.parentId }));
      },

      get: async (id) => { stats.bookmarks.get++; return [bookmarkStore.get(id)].filter(Boolean); },

      // Supports two query shapes: { url } for exact URL match, { title } for exact title match.
      search: async (query) => {
        stats.bookmarks.search++;
        return [...bookmarkStore.values()].filter(b =>
          query.url ? b.url === query.url : b.title === query.title
        );
      },

      // Returns the Firefox tree shape: [{ ...folder, children: [...sorted by index] }].
      getSubTree: async (id) => {
        stats.bookmarks.getSubTree++;
        const folder = bookmarkStore.get(id) ?? { id };
        const children = siblingsOf(id).sort((a, b) => a.index - b.index);
        return [{ ...folder, children }];
      },
    },

    tabs: {
      // Supports the filters this codebase actually uses: windowId, active, currentWindow.
      query: async (queryInfo = {}) => {
        let results = [...tabStore.values()];
        if (queryInfo.windowId !== undefined) results = results.filter(t => t.windowId === queryInfo.windowId);
        if (queryInfo.currentWindow) results = results.filter(t => t.windowId === DEFAULT_WINDOW_ID);
        if (queryInfo.active !== undefined) results = results.filter(t => t.active === queryInfo.active);
        return results;
      },

      get: async (tabId) => {
        const tab = tabStore.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },

      create: async ({ url, windowId, active = true } = {}) => {
        stats.tabs.create++;
        const finalWindowId = windowId ?? DEFAULT_WINDOW_ID;
        if (!windowStore.has(finalWindowId)) windowStore.set(finalWindowId, { id: finalWindowId, state: 'normal' });
        if (active) {
          for (const t of tabStore.values()) if (t.windowId === finalWindowId) t.active = false;
        }
        const tab = { id: nextTabId++, windowId: finalWindowId, url, title: '', active };
        tabStore.set(tab.id, tab);
        return tab;
      },

      update: async (tabId, changes) => {
        stats.tabs.update++;
        const tab = tabStore.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        if (changes.active) {
          for (const t of tabStore.values()) if (t.windowId === tab.windowId) t.active = false;
        }
        Object.assign(tab, changes);
        return tab;
      },
    },

    windows: {
      getCurrent: async () => windowStore.get(DEFAULT_WINDOW_ID),
    },

    // Stubs — tests don't assert on badge or menu behavior.
    action: {
      onClicked:              { addListener: () => {} },
      setBadgeText:           async () => {},
      setBadgeBackgroundColor: async () => {},
    },

    // Firefox-only menus namespace — used both by the service worker (the two
    // "put on Pile" items) and by the sidebar's highlight action. onClicked
    // supports multiple listeners, matching real Firefox, since both register
    // on it independently. getTargetElement returns null by default; tests
    // override it to point at the row a simulated right-click targeted.
    menus: {
      create: () => {},
      onShown: makeEvent(onMenuShownListeners),
      onClicked: makeEvent(onMenuClickedListeners),
      update: async () => {},
      refresh: () => {},
      overrideContext: () => {},
      getTargetElement: () => null,
    },

    storage: {
      local: {
        get: async (keys) => {
          if (!keys) return { ...storageData };
          const keyList = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(keyList.filter(k => k in storageData).map(k => [k, storageData[k]]));
        },
        set: async (obj) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: storageData[k], newValue: v };
            storageData[k] = v;
          }
          await Promise.all(onStorageChangedListeners.map(fn => fn(changes, 'local')));
        },
      },
      onChanged: makeEvent(onStorageChangedListeners),
    },

    i18n: { getMessage },
  };

  return mock;
}
