'use strict';

window.bookmarkListNode = document.createElement('ul');
window.updateCounter = 0;
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

// clicking on the navbar icon
browser.browserAction.onClicked.addListener((activeTab) => {
  addBookmark(activeTab);
});

// changing bookmarks (e.g. via the bookmarks manager)
function initBookmarksListener() {
  browser.bookmarks.onCreated.addListener(async (id, createdBookmark) => {
    console.log('background: onCreated');
    updateIfPiledBookmark(createdBookmark.parentId);
  });
  browser.bookmarks.onRemoved.addListener(async (id, removedObject) => {
    console.log('background: onRemoved');
    updateIfPiledBookmark(removedObject.parentId);
  });
  browser.bookmarks.onChanged.addListener(async (id) => {
    console.log('background: onChanged');
    let bookmarks = await browser.bookmarks.get(id);
    updateIfPiledBookmark(bookmarks[0].parentId);
  });
  browser.bookmarks.onMoved.addListener(async (id, movedObject) => {
    console.log('background: onMoved');
    updateIfPiledBookmark(movedObject.parentId);
  });
}

// helper function for browser.bookmarks event listeners
async function updateIfPiledBookmark(parentId) {
  let bookmarkFolderId = await getBookmarkFolderId();
  if (parentId === bookmarkFolderId) {
    semaphore.updateWhenPossible();
  }
}


// TODO: browser.bookmarks.onChildrenReordered.addListener(updateContent); // not yet supported by FF
// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks/onChildrenReordered


/* ------------------------------------------------ */
// Contextual Menu
/* ------------------------------------------------ */

// clicking on the contextual menu gives the user the option to bookmark and close tabs in one fell swoop
browser.contextMenus.onClicked.addListener((info, tab) => {
  switch(info.menuItemId) {
    case 'putOnPile':
      addBookmarkandClose(tab, true);
      break;
    case 'putAllOnPile':
      addAllBookmarksandClose(tab.windowId, false);
      break;
  }
});

function onCreatedErrorHandler() {
  if (browser.runtime.lastError) {
    logError('contextMenus.create', browser.runtime.lastError);
  }
}

browser.contextMenus.create({
  id: 'putOnPile',
  title: browser.i18n.getMessage('putOnPileMessage'),
  contexts: ['page', 'frame', 'image', 'page']
}, onCreatedErrorHandler);

browser.contextMenus.create({
  id: 'putAllOnPile',
  title: browser.i18n.getMessage('putAllOnPileMessage'),
  contexts: ['tab']
}, onCreatedErrorHandler);


/* ------------------------------------------------ */
// Data synchronisation
/* ------------------------------------------------ */

// the semaphore rejects unnecessary updates of the bookmark list during more complex operations (e.g. several bookmarks are deleted or reordered at once)
// registerChange: one or more bookmark changes are going to happen. Increase the process counter.
// changeFinished: one change has been executed. Update the list, but only if no other changes are currently being processed.
class Semaphore {
  constructor() {
    this.processes = 0;
  }
  registerChange() {
    this.processes++;
    console.log(`background semaphore: registerChange - ${this.processes} processes`);
  }
  changeFinished() {
    this.processes--;
    console.log(`background semaphore: changeFinished - ${this.processes} processes`);
    this.updateWhenPossible();
  }
  updateWhenPossible() {
    if (this.processes === 0) {
      console.log(`background semaphore update: ${this.processes} processes`);
      updateBookmarkListNode();
    } else {
      console.log('background semaphore: something is being processed. not updating html.');
      console.log(`background semaphore process counter: ${this.processes}`);
    }
  }
}
let semaphore = new Semaphore();


/* ------------------------------------------------ */
// Provide the html representation of pile bookmarks
/* ------------------------------------------------ */

// rebuild the complete list of bookmarks shown in all panels
// when needed: inform the active panels of all windows to fetch it and update their html
async function updateBookmarkListNode(bInformActivePanels = true) {
  console.log('background: updating html');
  try {
    let bookmarkFolderId = await getBookmarkFolderId();
    // TODO: the node returned by .search does not have children, but the node returned by .subtree does.
    // remove this extra step, when clarified
    let piledBookmarksTree = await browser.bookmarks.getSubTree(bookmarkFolderId);
    // go through all the children of the pile folder
    window.bookmarkListNode = document.createElement('ul');
    window.bookmarkListNode.id = 'bookmarklist';
    if (Object.prototype.hasOwnProperty.call(piledBookmarksTree[0], 'children')) {
      for (let bookmark of piledBookmarksTree[0].children) {
        window.bookmarkListNode.appendChild(createBookmarkNode(bookmark));
      }
    }
    // the updateCounter allows panel.js to check if it needs to update its DOM or not
    window.updateCounter++;
    if (window.updateCounter > 1023) { 
      window.updateCounter = 0;
    }
    console.log(`background: updateCounter: ${window.updateCounter}`);
    if (bInformActivePanels === true) {
      console.log('background: sending message');
      browser.runtime.sendMessage({
        message: 'updatePilePanel'
      });
    }
  } catch(error) {
    logError('updateBookmarkListNode', error);
  }
  return; 
}

// return html code representing a single bookmark 
function createBookmarkNode(bookmark) {
  let li = document.createElement('li');
  li.classList.add('bookmark');
  li.setAttribute('data-bookmarkid', bookmark.id);
  li.setAttribute('data-title', bookmark.title.toLowerCase());
  li.setAttribute('title', bookmark.title);
  let a = document.createElement('a');
  a.classList.add('link');
  a.setAttribute('href', bookmark.url);
  a.appendChild(document.createTextNode(bookmark.title));
  let button = document.createElement('button'); 
  button.classList.add('deletebutton');
  button.setAttribute('data-deleteid', bookmark.id);
  button.setAttribute('title', browser.i18n.getMessage('deleteBookmark'));
  let checkbox = document.createElement('input'); 
  checkbox.classList.add('cleanupcheckbox');
  checkbox.setAttribute('type', 'checkbox');
  checkbox.setAttribute('data-functionname', 'selectbookmark');
  checkbox.setAttribute('title', browser.i18n.getMessage('markForDeletion'));
  li.appendChild(a);
  li.appendChild(button);
  li.appendChild(checkbox);
  return li;
}


/* ------------------------------------------------ */
// Add or remove bookmarks
/* ------------------------------------------------ */

// remove a bookmark
// returns a Promise
function removeBookmark(id) {
  return browser.bookmarks.remove(id);
}

// add a bookmark
// returns the Promise of a newly added BookmarkTreeNode
async function addBookmark(tab) {
  let badgeText = '+1';
  let bookmark = undefined;
  try {
    semaphore.registerChange();
    let bookmarkFolderId = await getBookmarkFolderId();
    // do not add empty 'about:blank' (new empty tab) bookmarks
    if (tab.url === 'about:blank') {
      throw 'Not adding about:blank page';
    }
    // check if the bookmark already exists
    let bookmarks = await browser.bookmarks.search({url: tab.url})
    if (bookmarks.length > 0) {
      // delete doubles if they exist and change the badgeText
      for (let bookmark of bookmarks) {
        if (bookmarkFolderId === bookmark.parentId) {
          removeBookmark(bookmark.id);
          window.updateCounter++;
        }
        badgeText = '⬆';
      }
    }
    bookmark = await browser.bookmarks.create({ title: tab.title, url: tab.url, index: 0, parentId: bookmarkFolderId});
    console.log(bookmark);
    showBadge(badgeText);
  } catch(error) {
    logError('addBookmark', error);
    showErrorBadge();
  }
  semaphore.changeFinished();
  return bookmark;
}

// add a bookmark and close the tab
// returns true or false
async function addBookmarkandClose(tab, removePinned) {
  try {
    semaphore.registerChange();
    let tabs = await browser.tabs.query({ windowId: tab.windowId });
    // only remove pinned tabs when the user explicitly says so
    if ((removePinned === true)||(tab.pinned === false)) {
      await addBookmark(tab);
      if (tabs.length === 1) {
        await browser.tabs.create({});
        console.log('creating empty tab');
      } 
      await browser.tabs.remove(tab.id);
      semaphore.changeFinished();
      return true;
    }
  } catch(error) {
    logError('addBookmarkandClose', error);
  }
  semaphore.changeFinished();
  return false;
}

// close all tabs and bookmark all urls before
async function addAllBookmarksandClose(windowId) {
  let badgeText;
  let counter = 0;
  try {
    // get the bookmark folder and an array of all tabs
    await getBookmarkFolderId(); // wait
    let tabs = await browser.tabs.query({windowId: windowId});
    semaphore.registerChange();
    // create bookmarks and close tabs
    await Promise.all(tabs.map(async (tab) => {
      console.log(`removing tab: ${tab}`);
      if (await addBookmarkandClose(tab, false)) {
        counter++;
      }
      console.log(counter);
    }));
  } catch(error) {
    logError('addBookmarkandClose', error);
  }
  badgeText = `+${counter}`;
  showBadge(badgeText);
  semaphore.changeFinished();
}

// receives an array of bookmark ids
// removes said bookmarks in one fell swoop
async function removeBookmarks(bookmarkIDs) {
  let badgeText;
  let counter = 0;
  try {
    console.log("deleting multiple bookmarks");
    semaphore.registerChange();
    await Promise.all(bookmarkIDs.map(async (id) => {
      await removeBookmark(id);
      // TODO: deal with Promise rejection
      counter++;
    }));
  } catch(error) {
    logError('addBookmarkandClose', error);
    semaphore.changeFinished();
  }
  badgeText = `-${counter}`;
  showBadge(badgeText);
  semaphore.changeFinished();
  console.log(`${badgeText} bookmarks removed`);
}


/* ------------------------------------------------ */
// Visual feedback via badge
/* ------------------------------------------------ */

// show a badge on the toolbar button
function showBadge(badgeText) {
  setTimeout(() => {
    browser.browserAction.setBadgeBackgroundColor({color: '#5591FF'});
    browser.browserAction.setBadgeText({text: badgeText});
  }, 120);
  setTimeout(() => {
      browser.browserAction.setBadgeText({text: ''});
  }, 3200);
}

// give error feedback on the toolbar button
function showErrorBadge() {
  setTimeout(() => {
    browser.browserAction.setBadgeBackgroundColor({color: '#E23B03'});
    browser.browserAction.setBadgeText({text: 'X'});
  }, 120);
  setTimeout(() => {
      browser.browserAction.setBadgeText({text: ''});
  }, 3200);
}


/* ------------------------------------------------ */
// Helper functions
/* ------------------------------------------------ */

// get the pile bookmark folder node, or create one if there is none
async function getBookmarkFolderId() {
  let bookmarks = await browser.bookmarks.search({ title : bookmarkFolderName });
  // check all bookmarks titled 'Pile'
  if (bookmarks.length > 0) {
    for (let bookmark of bookmarks) {
      if (Object.prototype.hasOwnProperty.call(bookmark, 'type')) {
        if (bookmark.type === 'folder') {
          return bookmark.id;
        }
      }
    }
  } else {
    // No pile folder was found. Let's create one.
    semaphore.registerChange();
    console.log('background: creating bookmark folder');
    let bookmark = await browser.bookmarks.create({ title: bookmarkFolderName })
    .catch(error => {
      logError('getBookmarkFolderId', error)
      throw error; // TODO: DOES THAT WORK https://blog.grossman.io/how-to-write-async-await-without-try-catch-blocks-in-javascript/
    });
    semaphore.changeFinished();
    return bookmark.id;
  }
}


/* ------------------------------------------------ */
// Initialization
/* ------------------------------------------------ */
browser.tabs.query({active: true, currentWindow: true})
.then(() => {
  updateBookmarkListNode();
  initBookmarksListener();
});
