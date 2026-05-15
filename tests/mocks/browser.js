export function createBrowserMock() {
  const store = new Map();
  let nextId = 1;

  const stats = {
    messages: 0,
    bookmarks: { create: 0, remove: 0, get: 0, search: 0, getSubTree: 0 },
  };

  const messageListeners = [];
  const onCreatedListeners = [];
  const onRemovedListeners = [];
  const onChangedListeners = [];
  const onMovedListeners = [];

  function eventTarget(listeners) {
    return {
      addListener: fn => listeners.push(fn),
      trigger: (...args) => listeners.forEach(fn => fn(...args)),
    };
  }

  function siblingsOf(parentId) {
    return [...store.values()].filter(b => b.parentId === parentId);
  }

  // Add to store without firing events — used in tests to set up initial state
  function seed(entry) {
    const id = String(nextId++);
    const index = siblingsOf(entry.parentId).length;
    const record = { id, index, ...entry };
    store.set(id, record);
    return record;
  }

  const mock = {
    seed,
    stats,

    runtime: {
      id: 'pile-test-id',
      onInstalled: { addListener: () => {} },
      onMessage: eventTarget(messageListeners),
      // Routes a message to the registered onMessage listeners, just like Firefox does
      sendMessage: (msg) => {
        stats.messages++;
        for (const fn of messageListeners) {
          const result = fn(msg, { id: 'pile-test-id' });
          if (result !== undefined) return result;
        }
      },
    },

    bookmarks: {
      onCreated: eventTarget(onCreatedListeners),
      onRemoved: eventTarget(onRemovedListeners),
      onChanged: {
        addListener: fn => onChangedListeners.push(fn),
        trigger: (id, changeInfo) => {
          const item = store.get(id);
          if (item) Object.assign(item, changeInfo);
          onChangedListeners.forEach(fn => fn(id, changeInfo));
        },
      },
      onMoved: {
        addListener: fn => onMovedListeners.push(fn),
        trigger: (id, moveInfo) => onMovedListeners.forEach(fn => fn(id, moveInfo)),
      },
      create: async ({ title, url, parentId, index, type } = {}) => {
        stats.bookmarks.create++;
        const insertAt = index ?? siblingsOf(parentId).length;
        siblingsOf(parentId).forEach(b => { if (b.index >= insertAt) b.index++; });
        const id = String(nextId++);
        const bookmark = { id, title, url, parentId, index: insertAt, type: type ?? (url ? 'bookmark' : 'folder') };
        store.set(id, bookmark);
        onCreatedListeners.forEach(fn => fn(id, bookmark));
        return bookmark;
      },
      remove: async (id) => {
        stats.bookmarks.remove++;
        const bookmark = store.get(id);
        if (!bookmark) return;
        store.delete(id);
        siblingsOf(bookmark.parentId).forEach(b => { if (b.index > bookmark.index) b.index--; });
        onRemovedListeners.forEach(fn => fn(id, { parentId: bookmark.parentId }));
      },
      get: async (id) => { stats.bookmarks.get++; return [store.get(id)].filter(Boolean); },
      search: async (query) => {
        stats.bookmarks.search++;
        return [...store.values()].filter(b =>
          query.url ? b.url === query.url : b.title === query.title
        );
      },
      getSubTree: async (id) => {
        stats.bookmarks.getSubTree++;
        const folder = store.get(id) ?? { id };
        const children = siblingsOf(id).sort((a, b) => a.index - b.index);
        return [{ ...folder, children }];
      },
    },

    action: {
      onClicked:              { addListener: () => {} },
      setBadgeText:           async () => {},
      setBadgeBackgroundColor: async () => {},
    },

    contextMenus: {
      onClicked: { addListener: () => {} },
      create:    () => {},
    },

    storage: {
      local:     { get: async () => ({}) },
      onChanged: { addListener: () => {} },
    },

    i18n:  { getMessage: key => key },
    tabs:  { query: async () => [] },
  };

  return mock;
}
