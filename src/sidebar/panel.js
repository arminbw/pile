'use strict';

let pileFolderId;
let sidebarBookmarkList;
let contentArea;
let searchStyle;
let themeCSSName;

let cleanupMode = false;


/* ------------------------------------------------ */
// Debugging
/* ------------------------------------------------ */

function logError(functionName, error) {
  console.error(`Pile panel error: ${functionName}, ${error}`);
}


/* ------------------------------------------------ */
// Render bookmarks
/* ------------------------------------------------ */

function renderBookmark(bookmark) {
  let li = document.createElement('li');
  li.classList.add('bookmark');
  li.setAttribute('data-bookmarkid', bookmark.id);
  li.setAttribute('data-title', bookmark.title.toLowerCase());
  li.setAttribute('data-url', bookmark.url);
  li.setAttribute('title', bookmark.title);
  let a = document.createElement('a');
  a.classList.add('link');
  a.setAttribute('href', bookmark.url);
  a.appendChild(document.createTextNode(bookmark.title));
  let button = document.createElement('button');
  button.classList.add('delete-button');
  button.setAttribute('data-functionname', 'deletebookmark');
  button.setAttribute('title', browser.i18n.getMessage('deleteBookmark'));
  let checkboxBorderWrapper = document.createElement('div');
  checkboxBorderWrapper.classList.add('cleanup-checkbox-border');
  let checkbox = document.createElement('input');
  checkbox.classList.add('cleanup-checkbox');
  checkbox.setAttribute('type', 'checkbox');
  checkbox.setAttribute('data-functionname', 'selectbookmark');
  checkbox.setAttribute('title', browser.i18n.getMessage('markForDeletion'));
  checkboxBorderWrapper.appendChild(checkbox);
  li.appendChild(a);
  li.appendChild(button);
  li.appendChild(checkboxBorderWrapper);
  return li;
}


/* ------------------------------------------------ */
// Bookmark event listeners
/* ------------------------------------------------ */

browser.bookmarks.onCreated.addListener((id, bookmark) => {
  if (bookmark.parentId !== pileFolderId) return;
  if (!bookmark.url) return;
  const existing = sidebarBookmarkList.querySelector(`[data-url="${CSS.escape(bookmark.url)}"]`);
  if (existing) {
    existing.setAttribute('data-bookmarkid', id);
    sidebarBookmarkList.prepend(existing);
  } else {
    sidebarBookmarkList.prepend(renderBookmark(bookmark));
  }
});

browser.bookmarks.onRemoved.addListener((id, removeInfo) => {
  if (id === pileFolderId) {
    pileFolderId = null;
    fullRebuild([]);
    return;
  }
  if (removeInfo.parentId !== pileFolderId) return;
  getBookmarkElement(id)?.remove();
  if (cleanupMode) updateCleanupCounter();
});

browser.bookmarks.onChanged.addListener(async (id) => {
  if (!getBookmarkElement(id)) return;
  fullRebuild(await getSubTree());
});

browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  if (moveInfo.parentId !== pileFolderId && moveInfo.oldParentId !== pileFolderId) return;
  fullRebuild(await getSubTree());
});

async function getSubTree() {
  const tree = await browser.bookmarks.getSubTree(pileFolderId);
  return tree[0].children ?? [];
}


/* ------------------------------------------------ */
// UI event listeners
/* ------------------------------------------------ */

window.addEventListener('click', (event) => {
  const fn = event.target.dataset.functionname;
  switch (fn) {
      case 'addbookmark':
        // add bookmark by clicking on the add button
        // clear search before adding, so the users sees the newly added bookmark
        if (document.getElementById('toolbar').classList.contains('show-search-field')) {
          document.querySelector('.search-input-field').value = '';
          filterList('');
          document.querySelector('.search-input-field').focus();
        }
        addBookmark();
        return;
      case 'togglesearch':
        toggleSearch();
        return;
      case 'togglecleanup':
        if (cleanupMode) {
          stopCleanupMode();
        } else {
          startCleanupMode();
        }
        return;
      case 'deletebookmark':
        deleteBookmark(event.target.closest('li').dataset.bookmarkid);
        return;
    }

    if (cleanupMode) {
      switch (fn) {
        case 'selectbookmark':
          // highlight bookmark when checkbox is clicked
          event.target.closest('li').classList.toggle('selected');
          updateCleanupCounter();
          return;
        case 'selectall':
          selectAllBookmarks();
          return;
        case 'deselectall':
          deselectAllBookmarks();
          return;
        case 'deleteselected':
          deleteSelectedBookmarks();
          return;
        case 'cancelcleanup':
          stopCleanupMode();
          return;
      }
    }
});

document.querySelector('.search-input-field').addEventListener('input', (e) => {
  filterList(e.target.value)
});


/* ------------------------------------------------ */
// Update the list of Pile bookmarks in the panel
/* ------------------------------------------------ */

function fullRebuild(bookmarks) {
  // render an array of all bookmarks
  // the use spread operator to turn them into individual arguments for replaceChildren
  sidebarBookmarkList.replaceChildren(...bookmarks.map(renderBookmark));
  if (cleanupMode) updateCleanupCounter();
  const scrollbarWidth = sidebarBookmarkList.offsetWidth - sidebarBookmarkList.clientWidth + 14;
  sidebarBookmarkList.style.width = `calc(100% + ${scrollbarWidth}px)`;
}


/* ------------------------------------------------ */
// Change the theme of the sidebar
/* ------------------------------------------------ */

function changeTheme(newThemeCSSName) {
  console.log(newThemeCSSName);
  document.body.classList.remove(themeCSSName);
  document.body.classList.add(newThemeCSSName);
  themeCSSName = newThemeCSSName;
}

browser.storage.onChanged.addListener( (changes, areaName) => {
  if (changes['pile-theme']?.newValue) {
    console.log(changes);
    changeTheme(changes['pile-theme'].newValue);
  }
});


/* ------------------------------------------------ */
// Sidebar user interaction
/* ------------------------------------------------ */

// delete a bookmark and show an animation
function deleteBookmark(id) {
  if (id) {
    console.log(`deleting ${id}`);
    let li = getBookmarkElement(id);
    li.classList.add('being-deleted');
    let scrollablePart = sidebarBookmarkList.scrollHeight - sidebarBookmarkList.offsetHeight;
    let distanceToBottom = scrollablePart - sidebarBookmarkList.scrollTop;
    if ((sidebarBookmarkList.scrollTopMax > 38) && (distanceToBottom < 38)) {
      sidebarBookmarkList.classList.add('foldup');
      li.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform') {
          let scrollTop = sidebarBookmarkList.scrollTop - 38;
          sidebarBookmarkList.removeChild(li);
          browser.bookmarks.remove(id);
          sidebarBookmarkList.classList.remove('foldup');
          sidebarBookmarkList.scrollTo(0, scrollTop);
        }
      }, false);
    } else {
      if ((sidebarBookmarkList.scrollTop > 0) && (distanceToBottom < 38)) {
        sidebarBookmarkList.scrollTo(0, 0);
      }
      li.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform') {
          sidebarBookmarkList.removeChild(li);
          browser.bookmarks.remove(id);
        }
      }, false);
    }
  }
}

// helper for deleteBookmark
function getBookmarkElement(bookmarkID) {
  return sidebarBookmarkList.querySelector('[data-bookmarkid="' + bookmarkID + '"]');
}

// play a CSS animation once
function playCSSAnimation(htmlElement, cssClass, animationName) {
  htmlElement.classList.add(cssClass);
  const stopAnimation = function(event) {
    if (event.animationName === animationName) {
      htmlElement.classList.remove(cssClass);
      htmlElement.removeEventListener('animationend', stopAnimation);
    }
  }
  htmlElement.addEventListener('animationend', stopAnimation);
}

// add a bookmark and show an animation
async function addBookmark() {
  const tabs = await browser.tabs.query({active: true, currentWindow: true});
  const tab = tabs[0];
  if (tab.url === 'about:blank') return;
  const optimistic = renderBookmark({ id: '', url: tab.url, title: tab.title });
  sidebarBookmarkList.prepend(optimistic);
  playCSSAnimation(sidebarBookmarkList, 'adding', 'animation-slidein');
  try {
    const response = await browser.runtime.sendMessage({ type: 'ADD_BOOKMARK', tab: { url: tab.url, title: tab.title } });
    pileFolderId = response.folderId;
    // onCreated fires → finds element by data-url → updates data-bookmarkid → moves to top
  } catch(error) {
    logError('addBookmark', error);
    optimistic.remove();
    const errorHtmlElement = document.querySelector('.add-bookmark');
    playCSSAnimation(errorHtmlElement, 'shaking', 'animation-shake-x');
  }
}

// fold/unfold the search input field
function toggleSearch() {
  const toolbar = document.getElementById('toolbar');
  const cssClassShowSearchField = 'show-search-field';
  if (toolbar.classList.contains(cssClassShowSearchField)) {
    document.querySelector('.search-input-field').value = '';
    filterList('');
    toolbar.classList.remove(cssClassShowSearchField);
    const bookmarkHtmlElement = document.querySelector('.add-bookmark');
    playCSSAnimation(bookmarkHtmlElement, 'hide-search-field', 'transition-button-add-large');
  } else {
    toolbar.classList.add(cssClassShowSearchField);
    document.querySelector('.search-input-field').focus();
  }
}

// hackish search/filter functionality (don't try this at home!)
function filterList(terms) {
  if (searchStyle.sheet.cssRules.length > 1) {
    searchStyle.sheet.deleteRule(0);
    searchStyle.sheet.deleteRule(0);
  }
  if (!terms) return;
  const searchTerms = terms.toLowerCase().split(' ');
  let rules = searchTerms.reduce((accumulator, term) => {
    if (term !== '') accumulator += '[data-title*=\'' + term + '\']';
    return accumulator;
  }, 'li.bookmark');
  rules += ' { display: flex; }';
  searchStyle.sheet.insertRule(rules);
  searchStyle.sheet.insertRule('li.bookmark { display: none; }');
}


/* ------------------------------------------------ */
// Cleanup mode sidebar user interaction
/* ------------------------------------ ------------ */

function startCleanupMode() {
  cleanupMode = true;
  document.getElementById('content').classList.add('cleanup-mode');
  updateCleanupCounter();
}

function stopCleanupMode() {
  cleanupMode = false;
  document.getElementById('content').classList.remove('cleanup-mode');
}

function updateCleanupCounter() {
  const bookmarkCount = sidebarBookmarkList.children.length;
  const selectedCount = document.querySelectorAll('.selected').length;
  let cleanupCounterEl = document.querySelector('.cleanup-counter-selected');
  let cleanupCounterContextEl = document.querySelector('.cleanup-counter-context');
  let SelectAllOrNoneEl = document.querySelector('.select-all-or-none-button');
  if (bookmarkCount === 0) {
    cleanupCounterEl.textContent = '';
    cleanupCounterContextEl.textContent = browser.i18n.getMessage("cleanedUp");
    SelectAllOrNoneEl.classList.remove('none');
  } else {
    let ofLan = browser.i18n.getMessage("of");
    cleanupCounterEl.textContent = selectedCount;
    cleanupCounterContextEl.textContent = ` ${ofLan} ${bookmarkCount}`;
    if ((bookmarkCount !== 0) && (selectedCount === bookmarkCount)) {
      SelectAllOrNoneEl.classList.add('none');
    } else {
      SelectAllOrNoneEl.classList.remove('none');
    }
  }
}

function selectAllBookmarks() {
  let bookmarkCount = sidebarBookmarkList.children.length;
  if (bookmarkCount === 0) {
    let feedbackEl = document.querySelector('.cleanup-counter');
    playCSSAnimation(feedbackEl, 'shaking', 'animation-shake-x');
  } else {
    for (let bookmark of sidebarBookmarkList.children) {
      let checkboxEl = bookmark.querySelector('.cleanup-checkbox');
      if (!checkboxEl.checked) {
        checkboxEl.checked = true;
        bookmark.classList.add('selected');
      }
    }
    document.querySelector('.select-all-or-none-button').classList.add('none');
    updateCleanupCounter();
  }
}

function deselectAllBookmarks() {
  for (let bookmark of sidebarBookmarkList.children) {
    let checkboxEl = bookmark.querySelector('.cleanup-checkbox');
    if (checkboxEl.checked) {
      checkboxEl.checked = false;
      bookmark.classList.remove('selected');
    }
  }
  document.querySelector('.select-all-or-none-button').classList.remove('none');
  updateCleanupCounter();
}

function deleteSelectedBookmarks() {
  let selectedNodes = document.querySelectorAll('.selected');
  if (selectedNodes.length === 0) {
    const bookmarkCount = sidebarBookmarkList.children.length;
    if (bookmarkCount === 0) {
      const feedbackEl = document.querySelector('.cleanup-counter');
      playCSSAnimation(feedbackEl, 'shaking', 'animation-shake-x');
    } else {
      const feedbackEl = document.querySelector('.select-all-or-none-button');
      playCSSAnimation(feedbackEl, 'shaking', 'animation-shake-x');
    }
  } else {
    const bookmarkIDs = Array.from(selectedNodes).map(el => el.dataset.bookmarkid);
    selectedNodes.forEach(node => node.remove());
    Promise.all(bookmarkIDs.map(id => browser.bookmarks.remove(id)));
    if (cleanupMode && sidebarBookmarkList.children.length === 0) {
      stopCleanupMode();
    }
  }
}


/* ------------------------------------------------ */
// Initialization
/* ------------------------------------------------ */

async function init() {
  sidebarBookmarkList = document.querySelector('ul.bookmarks');
  contentArea = document.querySelector('#content');

  setTimeout(() => {
    document.body.classList.remove('no-animations');
  }, 650);

  browser.storage.local.get('pile-theme').then((obj) => {
    console.log(obj);
    changeTheme(obj['pile-theme']);
  }, logError);

  searchStyle = document.createElement('style');
  searchStyle.appendChild(document.createTextNode(''));
  document.head.appendChild(searchStyle);

  contentArea.addEventListener('contextmenu', function(e) {
    if (e.target.className !== 'link') {
      e.preventDefault();
    }
  }, false);

  document.querySelectorAll('[data-localize-text]').forEach(el => {
    el.textContent = browser.i18n.getMessage(el.dataset.localizeText);
  });
  document.querySelectorAll('[data-localize-title]').forEach(el => {
    el.title = browser.i18n.getMessage(el.dataset.localizeTitle);
  });
  document.querySelector('.search-input-field').textContent = browser.i18n.getMessage('search');

  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_BOOKMARKS' });
    pileFolderId = response.folderId;
    fullRebuild(response.bookmarks);
  } catch (error) {
    logError('init', error);
  }
}

init();
