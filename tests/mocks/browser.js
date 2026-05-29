export function createBrowserMock() {
  // Single in-memory bookmarkStore shared across all bookmark API methods.
  // Every entry is keyed by its string id and carries { id, parentId, index, title, url?, type? }.
  const bookmarkStore = new Map();
  let nextId = 1;

  // Counts every API call — read in tests to verify efficiency.
  const stats = {
    messages: 0,
    bookmarks: { create: 0, remove: 0, get: 0, search: 0, getSubTree: 0 },
  };

  const messageListeners = [];
  const onCreatedListeners = [];
  const onRemovedListeners = [];
  const onChangedListeners = [];
  const onMovedListeners = [];

  // Returns an { addListener, trigger } pair so tests can both register listeners
  // (via addListener, same as production code) and fire them directly (via trigger).
  function makeEvent(listeners) {
    return {
      addListener: fn => listeners.push(fn),
      trigger: (...args) => listeners.forEach(fn => fn(...args)),
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

  const mock = {
    seed,
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

    // Stubs — tests don't assert on badge or menu behavior.
    action: {
      onClicked:              { addListener: () => {} },
      setBadgeText:           async () => {},
      setBadgeBackgroundColor: async () => {},
    },

    contextMenus: {
      onClicked: { addListener: () => {} },
      create:    () => {},
    },

    // storage.local.get always returns {} (no theme set); onChanged is a no-op stub.
    storage: {
      local:     { get: async () => ({}) },
      onChanged: { addListener: () => {} },
    },

    // i18n returns the key itself, so localized strings in the DOM equal their key names.
    i18n:  { getMessage: key => key },
    tabs:  { query: async () => [] },
  };

  return mock;
}
