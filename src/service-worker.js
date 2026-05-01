'use strict';

const bookmarkFolderName = 'Pile';

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


/* ------------------------------------------------ */
// Contextual Menu
/* ------------------------------------------------ */

browser.contextMenus.onClicked.addListener((info, tab) => {
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
  browser.contextMenus.create({
    id: 'putOnPile',
    title: browser.i18n.getMessage('putOnPileMessage'),
    contexts: ['page', 'frame', 'image', 'page']
  });
  browser.contextMenus.create({
    id: 'putAllOnPile',
    title: browser.i18n.getMessage('putAllOnPileMessage'),
    contexts: ['tab']
  });
});


/* ------------------------------------------------ */
// Message handler
/* ------------------------------------------------ */

browser.runtime.onMessage.addListener((request, sender) => {
  if (sender.id !== browser.runtime.id) return;
  switch (request.type) {
    case 'GET_BOOKMARKS':
      return getBookmarkFolderId().then(async (folderId) => {
        const tree = await browser.bookmarks.getSubTree(folderId);
        return { bookmarks: tree[0].children ?? [], folderId };
      });
    case 'ADD_BOOKMARK':
      return addBookmark(request.tab).then(async (bookmark) => ({
        bookmark,
        folderId: await getBookmarkFolderId()
      }));
  }
});


/* ------------------------------------------------ */
// Add bookmarks
/* ------------------------------------------------ */

function removeBookmark(id) {
  return browser.bookmarks.remove(id);
}

async function addBookmark(tab) {
  let badgeText = '+1';
  let bookmark;
  try {
    let bookmarkFolderId = await getBookmarkFolderId();
    if (tab.url === 'about:blank') {
      throw 'Not adding about:blank page';
    }
    let bookmarks = await browser.bookmarks.search({url: tab.url});
    if (bookmarks.length > 0) {
      for (let existing of bookmarks) {
        if (bookmarkFolderId === existing.parentId) {
          removeBookmark(existing.id);
        }
        badgeText = '↑';
      }
    }
    bookmark = await browser.bookmarks.create({ title: tab.title, url: tab.url, index: 0, parentId: bookmarkFolderId });
    showBadge(badgeText);
  } catch(error) {
    logError('addBookmark', error);
    showErrorBadge();
  }
  return bookmark;
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
    browser.action.setBadgeBackgroundColor({color: '#5591FF'});
    browser.action.setBadgeText({text: badgeText});
  }, 120);
  setTimeout(() => {
    browser.action.setBadgeText({text: ''});
  }, 3200);
}

function showErrorBadge() {
  setTimeout(() => {
    browser.action.setBadgeBackgroundColor({color: '#E23B03'});
    browser.action.setBadgeText({text: 'X'});
  }, 120);
  setTimeout(() => {
    browser.action.setBadgeText({text: ''});
  }, 3200);
}


/* ------------------------------------------------ */
// Helper functions
/* ------------------------------------------------ */

let cachedFolderId = null;

async function getBookmarkFolderId() {
  if (cachedFolderId) return cachedFolderId;
  let bookmarks = await browser.bookmarks.search({ title: bookmarkFolderName });
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
  let folder = await browser.bookmarks.create({ title: bookmarkFolderName })
    .catch(error => {
      logError('getBookmarkFolderId', error);
      throw error;
    });
  cachedFolderId = folder.id;
  return cachedFolderId;
}
