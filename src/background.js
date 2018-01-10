"use strict";

window.bookmarkListNode = document.createElement("ul");
window.updateCounter = 0;
const bookmarkFolderName = "Pile";

function logError(functionName, error) {
  console.error(`Pile background error: ${functionName}, ${error}`);
}

// the semaphore rejects unnecessary updates of the bookmark list during more complex operations (e.g. several bookmarks are deleted or reordered at once)
// registerChange: a bookmark change is going to happen
//                 increase the process counter
// changeFinished: one change has been executed. Update the list, if no other changes are being processed.
class Semaphore {
  constructor() {
    this.processes = 0;
  }
  registerChange() {
    this.processes++;
    console.log("background semaphore: register change");
  }
  changeFinished() {
    this.processes--;
    this.updateWhenPossible();
  }
  updateWhenPossible() {
    if (this.processes === 0) {
      console.log(`background semaphore update: ${this.processes} processes`);
      updateBookmarkListNode();
    } else {
      console.log("background semaphore: something is being processed. not updating html.");
      console.log(this.processes);
    }
  }
}
let semaphore = new Semaphore();

/* ------------------------------------------------ */
// Browser event listeners
/* ------------------------------------------------ */

// clicking on the navbar icon
browser.browserAction.onClicked.addListener((activeTab) => {
  addBookmark(activeTab);
});

// changing bookmarks (e.g. via the bookmarks manager)
// todo: only update if anything changed within the pile folder?
function initBookmarksListener() {
  browser.bookmarks.onCreated.addListener(() => { 
    console.log("background: onCreated");
    semaphore.updateWhenPossible()});
  browser.bookmarks.onRemoved.addListener(() => {
    console.log("background: onRemoved");
    semaphore.updateWhenPossible()});
  browser.bookmarks.onChanged.addListener(() => {
    console.log("background: onChanged");
    semaphore.updateWhenPossible()});
}

// TODO: browser.bookmarks.onChildrenReordered.addListener(updateContent); // not yet supported by FF
// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks/onChildrenReordered

/* ------------------------------------------------ */
// Contextual Menu
/* ------------------------------------------------ */
// clicking on the contextual menu
browser.contextMenus.onClicked.addListener((info, tab) => {
  switch(info.menuItemId) {
    case "putOnPile":
      addBookmarkandClose(tab);
      break;
    case "putAllOnPile":
      addAllBookmarksandClose(tab.windowId);
      break;
  }
});

function onCreatedErrorHandler() {
  if (browser.runtime.lastError) {
    logError("contextMenus.create", browser.runtime.lastError);
  }
}

browser.contextMenus.create({
  id: "putOnPile",
  title: browser.i18n.getMessage("putOnPileMessage"),
  contexts: ["page", "frame", "image"]
}, onCreatedErrorHandler);

browser.contextMenus.create({
  id: "putOnPile",
  title: browser.i18n.getMessage("putOnPileMessage"),
  contexts: ["tab"]
}, onCreatedErrorHandler);

browser.contextMenus.create({
  id: "putAllOnPile",
  title: browser.i18n.getMessage("putAllOnPileMessage"),
  contexts: ["tab"]
}, onCreatedErrorHandler);

/* ------------------------------------------------ */
// Core functionality
/* ------------------------------------------------ */
// get the pile bookmark folder node, or create one if there is none
// returns a Promise
function getBookmarkFolderId() {
  let bookmarkFolderPromise = new Promise((resolve, reject) => {
    browser.bookmarks.search({ title : bookmarkFolderName })
    .then(bookmarks => {
      // check all bookmarks titled 'Pile'
      if (bookmarks.length > 0) {
        for (let bookmark of bookmarks) {
          // FF version > 57 needed for this
          if (bookmark.hasOwnProperty('type')) {
            if (bookmark.type === 'folder') {
              return resolve(bookmark.id);
            }
          }
        }
        // none of the found pile bookmarks is a folder
      }
      // no pile folder available, let's create one
      // Todo: folder icon pileIcon = request("images/pile.ico");
      // Todo: proper error handling
      semaphore.registerChange();
      browser.bookmarks.create({ title: bookmarkFolderName })
      .then((bookmarkFolder) => {
        console.log("background: creating bookmark folder");
        resolve(bookmarkFolder.id);
        semaphore.changeFinished();
      })
      .catch(error => {
        reject(error);
        semaphore.changeFinished();
      });
    });
  });
  return bookmarkFolderPromise;
}

// rebuild the complete list of bookmarks shown in all sidebars
// when needed: inform the active panels of all windows to fetch it and update their html
// returns a Promise
function updateBookmarkListNode(bInformActivePanels = true) {
  console.log('background: updating html');
  // search for a bookmark folder called 'pile' and get the subtree of it
  let updateBookmarkListNodesPromise = getBookmarkFolderId()
  .then(bookmarkFolderId => {
    // TODO: the node returned by .search does not have children, but the node returned by .subtree does.
    // remove this extra step, when clarified
    return browser.bookmarks.getSubTree(bookmarkFolderId);
  })
  .then(bookMarkFolderTree => {
    // go through all the children of the pile folder
    window.bookmarkListNode = document.createElement("ul");
    window.bookmarkListNode.id = "bookmarklist";
    if (bookMarkFolderTree[0].hasOwnProperty("children")) {
      for (let bookmark of bookMarkFolderTree[0].children) {
        window.bookmarkListNode.appendChild(createBookmarkNode(bookmark));
      }
    }
    // the updateCounter helps to the panel.js to check, if it needs an update or not
    // TODO: remove this complexity and just deal with the extra copy?
    window.updateCounter++;
    if (window.updateCounter > 1023) { 
      window.updateCounter = 0;
    }
    console.log(`background: updateCounter: ${window.updateCounter}`);
    if (bInformActivePanels === true) {
      console.log("background: sending message");
      browser.runtime.sendMessage({
        message: "update"
      });
    }
    return;
  })
  .catch(error => logError("updateBookmarkListNode", error));
  return updateBookmarkListNodesPromise;
}

// return html code representing a single bookmark 
function createBookmarkNode(bookmark) {
  let li = document.createElement("li");
  li.classList.add("bookmark");
  li.setAttribute("data-bookmarkid", bookmark.id);
  li.setAttribute("data-title", bookmark.title.toLowerCase());
  li.setAttribute("title", bookmark.title);
  let a = document.createElement("a");
  a.classList.add("link");
  a.setAttribute("href", bookmark.url);
  a.appendChild(document.createTextNode(bookmark.title));
  let button = document.createElement("button"); 
  button.classList.add("deletebutton");
  button.setAttribute("data-deleteid", bookmark.id);
  button.setAttribute("title", "remove");
  li.appendChild(a);
  li.appendChild(button);
  return li; 
}

// show a badge on the toolbar button
function showBadge(badgeText) {
  setTimeout(() => {
    browser.browserAction.setBadgeBackgroundColor({color: "#5591FF"});
    browser.browserAction.setBadgeText({text: badgeText});
  }, 120);
  setTimeout(() => {
      browser.browserAction.setBadgeText({text: ""});
  }, 3200);
}

// give error feedback on the toolbar button
function showErrorBadge() {
  setTimeout(() => {
    browser.browserAction.setBadgeBackgroundColor({color: "#E36A40"});
    browser.browserAction.setBadgeText({text: "ERR"});
  }, 120);
  setTimeout(() => {
      browser.browserAction.setBadgeText({text: ""});
  }, 3200);
}

function removeBookmark(id) {
  return browser.bookmarks.remove(id);
}

// add a bookmark
// returns a Promise with a newly added BookmarkTreeNode
function addBookmark(tab) {
  let badgeText = "+1";
  semaphore.registerChange();
  let addBookmarkPromise = getBookmarkFolderId()
  .then((bookmarkFolderId) => {
    // check if the bookmarks already exists
    let createBookmarkPromise = browser.bookmarks.search({url: tab.url})
    .then((bookmarks) => {
        if (bookmarks.length > 0) {
          // delete doubles if they exist and change the badgeText
          for (let bookmark of bookmarks) {
            if (bookmarkFolderId === bookmark.parentId) {
              removeBookmark(bookmark.id);
              window.updateCounter++;
            }
            badgeText = "⬆";
          }
        }
        return;
    })
    .then(() => {
      return browser.bookmarks.create({ title: tab.title, url: tab.url, index: 0, parentId: bookmarkFolderId});
    })
    return createBookmarkPromise;
  })
  .then((newbookmark) => {
    showBadge(badgeText);
    semaphore.changeFinished();
    return newbookmark;
  })
  .catch(error => {
    logError("addBookmark", error);
    showErrorBadge(badgeText);
    semaphore.changeFinished();
    return error;
  });
  return addBookmarkPromise;
}

// add a bookmark and close the tab
// returns a promise
function addBookmarkandClose(tab) {
  semaphore.registerChange();
  let addBookmarkAndClosePromise = addBookmark(tab)
  .then(() => {
    return browser.tabs.query({ windowId: tab.windowId });
  })
  .then((tabs) => {
    if (tabs.length === 1) { 
      browser.tabs.create({})
      .then(() => {
        return browser.tabs.remove(tab.id);
      });
    } else {
      return browser.tabs.remove(tab.id);
    }
  })
  .then(() => {
    semaphore.changeFinished();
  })
  .catch(error => {
    logError("addBookmarkandClose", error);
    semaphore.changeFinished();
  });
  return addBookmarkAndClosePromise;
}

// close all tabs and bookmark all urls before
// TODO: check if some bookmarks couldn't be added and change the badge accordingly
function addAllBookmarksandClose(windowId) {
  // get the bookmark folder and the an array of all tabs
  // Todo: promise.all overkill. use wait instead?
  Promise.all([getBookmarkFolderId(), browser.tabs.query({windowId: windowId})])
  .then(values => {
    let tabs = values[1];
    // now create bookmarks and close tabs in parallel
    semaphore.registerChange();
    Promise.all(tabs.map(tab => {
      return addBookmarkandClose(tab);
    }))
    .then(() => {
      showBadge(`+${tabs.length}`);
      console.log("all closed");
      semaphore.changeFinished();
    })
    .catch(error => {
      logError("addAllBookmarksandClose", error);
      semaphore.changeFinished();
    });  
  })
}

/* ------------------------------------------------ */
// Initialization
/* ------------------------------------------------ */

browser.tabs.query({active: true, currentWindow: true})
.then(() => {
  updateBookmarkListNode();
  initBookmarksListener();
});
