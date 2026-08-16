'use strict';

/* ------------------------------------------------ */
// Debugging
/* ------------------------------------------------ */

function logError(functionName, error) {
  console.error(`Pile background error: ${functionName}, ${error}`);
  showErrorBadge();
}


/* ------------------------------------------------ */
// Browser event listeners
/* ------------------------------------------------ */

browser.action.onClicked.addListener((activeTab) => {
  addBookmark(activeTab);
});

browser.bookmarks.onRemoved.addListener((id) => {
  if (id === cachedFolderId) cachedFolderId = null;
});

browser.storage.onChanged.addListener(async (changes) => {
  if (!('pile-folder-name' in changes)) return;
  const newName = (changes['pile-folder-name'].newValue || '').trim() || 'Pile';
  if (cachedFolderId) {
    await browser.bookmarks.update(cachedFolderId, { title: newName })
      .catch(error => logError('renamePileFolder', error));
  } else {
    const oldName = (changes['pile-folder-name'].oldValue || '').trim() || 'Pile';
    const results = await browser.bookmarks.search({ title: oldName });
    for (const b of results) {
      if (b.type === 'folder') {
        await browser.bookmarks.update(b.id, { title: newName })
          .catch(error => logError('renamePileFolder', error));
        cachedFolderId = b.id;
        break;
      }
    }
  }
});


/* ------------------------------------------------ */
// Contextual Menu
/* ------------------------------------------------ */

// Firefox exposes browser.contextMenus only under the "contextMenus" permission
// and browser.menus only under "menus" — they are NOT aliases of each other
// despite offering the same API shape. The manifest declares "menus", so every
// call here goes through that namespace.
browser.menus.onClicked.addListener((info, tab) => {
  switch(info.menuItemId) {
    case 'putOnPile':
      addBookmarkandClose(tab, true);
      break;
    case 'putAllOnPile':
      addAllBookmarksAndClose(tab.windowId, false);
      break;
  }
});

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: 'putOnPile',
    title: browser.i18n.getMessage('putOnPileMessage'),
    contexts: ['page', 'frame', 'image'],
    // web pages only — keeps this item out of Pile's own sidebar
    documentUrlPatterns: ['http://*/*', 'https://*/*']
  });
  browser.menus.create({
    id: 'putAllOnPile',
    title: browser.i18n.getMessage('putAllOnPileMessage'),
    contexts: ['tab']
  });
  // Shown in the Pile sidebar only, via menus.overrideContext in panel.js.
  // The panel also retitles it per row (highlight vs. un-highlight) and
  // handles the click; see "Highlighted bookmarks" there.
  browser.menus.create({
    id: 'toggle-highlight',
    title: browser.i18n.getMessage('highlightBookmark'),
    contexts: ['page', 'link'],
    viewTypes: ['sidebar'],
    documentUrlPatterns: [browser.runtime.getURL('sidebar/panel.html')]
  });
});


/* ------------------------------------------------ */
// Message handler
/* ------------------------------------------------ */

browser.runtime.onMessage.addListener((request, sender) => {
  if (sender.id !== browser.runtime.id) return;
  switch (request.type) {
    case 'GET_BOOKMARKS_AND_FOLDERID':
      return getBookmarkFolderId().then(async (folderId) => {
        const tree = await browser.bookmarks.getSubTree(folderId);
        return { bookmarks: tree[0].children ?? [], folderId };
      });
    case 'ADD_BOOKMARK':
      return addBookmark(request.tab).then((bookmark) => ({ bookmark }));  
  }
});


/* ------------------------------------------------ */
// Add and remove bookmarks
/* ------------------------------------------------ */

function removeBookmark(id) {
  return browser.bookmarks.remove(id);
}

async function addBookmark(tab) {
  let badgeText = '+1';
  try {
    let bookmarkFolderId = await getBookmarkFolderId();
    if (tab.url.startsWith('about:')) {
      throw 'Not adding about: page';
    }
    let bookmarks = await browser.bookmarks.search({url: tab.url});
    if (bookmarks.length > 0) {
      for (let existing of bookmarks) {
        if (bookmarkFolderId === existing.parentId) {
          // The bookmark already exists. We remove it and add a new one on top of the pile. 
          await removeBookmark(existing.id);
          badgeText = '↑';
        }
      }
    }
    const bookmark = await browser.bookmarks.create({ title: tab.title, url: tab.url, index: 0, parentId: bookmarkFolderId });
    showBadge(badgeText);
    return bookmark;
  } catch(error) {
    logError('addBookmark', error);
    showErrorBadge();
    throw error;
  }
}

async function addBookmarkandClose(tab, removePinned) {
  try {
    let tabs = await browser.tabs.query({ windowId: tab.windowId });
    if ((removePinned === true) || (tab.pinned === false)) {
      await addBookmark(tab);
      if (tabs.length === 1) {
        await browser.tabs.create({});
      }
      await browser.tabs.remove(tab.id);
      return true;
    }
  } catch(error) {
    logError('addBookmarkandClose', error);
  }
  return false;
}

async function addAllBookmarksAndClose(windowId) {
  let counter = 0;
  try {
    await getBookmarkFolderId();
    let tabs = await browser.tabs.query({windowId: windowId});
    await Promise.all(tabs.map(async (tab) => {
      if (await addBookmarkandClose(tab, false)) {
        counter++;
      }
    }));
  } catch(error) {
    logError('addAllBookmarksAndClose', error);
  }
  showBadge(`+${counter}`);
}


/* ------------------------------------------------ */
// Visual feedback via badge
/* ------------------------------------------------ */

function showBadge(badgeText) {
  setTimeout(() => {
    browser.action.setBadgeBackgroundColor({color: '#a7bee8'});
    browser.action.setBadgeText({text: badgeText});
  }, 120);
  setTimeout(() => {
    browser.action.setBadgeText({text: ''});
  }, 3200);
}

function showErrorBadge() {
  setTimeout(() => {
    browser.action.setBadgeBackgroundColor({color: '#fa7f28'});
    browser.action.setBadgeText({text: '✕'});
  }, 120);
  setTimeout(() => {
    browser.action.setBadgeText({text: ''});
  }, 3200);
}


/* ------------------------------------------------ */
// Helper functions
/* ------------------------------------------------ */

let cachedFolderId = null;

async function getFolderName() {
  const result = await browser.storage.local.get('pile-folder-name');
  return (result['pile-folder-name'] || '').trim() || 'Pile';
}

async function getBookmarkFolderId() {
  if (cachedFolderId) return cachedFolderId;
  const folderName = await getFolderName();
  let bookmarks = await browser.bookmarks.search({ title: folderName });
  if (bookmarks.length > 0) {
    for (let bookmark of bookmarks) {
      if (Object.prototype.hasOwnProperty.call(bookmark, 'type')) {
        if (bookmark.type === 'folder') {
          cachedFolderId = bookmark.id;
          return cachedFolderId;
        }
      }
    }
  }
  let folder = await browser.bookmarks.create({ title: folderName })
    .catch(error => {
      logError('getBookmarkFolderId', error);
      throw error;
    });
  cachedFolderId = folder.id;
  return cachedFolderId;
}
