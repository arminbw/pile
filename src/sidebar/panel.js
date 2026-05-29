'use strict';

let pileFolderId;
let sidebarBookmarkList;
let contentArea;
let searchStyle;
let themeCSSName = 'theme-light';
let searchInputField;
let toolbar;
let addBookmarkButton;

let cleanupMode = false;
let optimisticElement = null;


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
  checkboxBorderWrapper.classList.add('cleanup-checkbox-container');
  checkboxBorderWrapper.setAttribute('data-functionname', 'selectbookmark');
  checkboxBorderWrapper.setAttribute('title', browser.i18n.getMessage('markForDeletion'));
  let checkbox = document.createElement('input');
  checkbox.classList.add('cleanup-checkbox');
  checkbox.setAttribute('type', 'checkbox');
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
  if (optimisticElement && bookmark.url === optimisticElement.dataset.url) {
    optimisticElement.setAttribute('data-bookmarkid', id);
    optimisticElement = null;
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

browser.bookmarks.onChanged.addListener((id, changeInfo) => {
  const li = getBookmarkElement(id);
  if (!li) return;
  if (changeInfo.title) {
    li.setAttribute('data-title', changeInfo.title.toLowerCase());
    li.setAttribute('title', changeInfo.title);
    li.querySelector('.link').textContent = changeInfo.title;
  }
  if (changeInfo.url) {
    li.setAttribute('data-url', changeInfo.url);
    li.querySelector('.link').setAttribute('href', changeInfo.url);
  }
});

browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  const newParentIsPile = moveInfo.parentId === pileFolderId;
  const oldParentWasPile = moveInfo.oldParentId === pileFolderId;
  if (!newParentIsPile && !oldParentWasPile) return;

  const li = getBookmarkElement(id);
  li?.remove();

  if (newParentIsPile) {
    const el = li ?? renderBookmark((await browser.bookmarks.get(id))[0]);
    sidebarBookmarkList.insertBefore(el, sidebarBookmarkList.children[moveInfo.index] ?? null);
  }
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
  document.body.classList.remove(themeCSSName);
  document.body.classList.add(newThemeCSSName);
  themeCSSName = newThemeCSSName;
}

browser.storage.onChanged.addListener( (changes, areaName) => {
  if (changes['pile-theme']?.newValue) {
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
    if (!li) return;
    li.classList.add('being-deleted');
    let scrollablePart = sidebarBookmarkList.scrollHeight - sidebarBookmarkList.offsetHeight;
    let distanceToBottom = scrollablePart - sidebarBookmarkList.scrollTop;
    // Note: scrollTopMax is a Firefox-only property
    if ((sidebarBookmarkList.scrollTopMax > 38) && (distanceToBottom < 38)) {
      sidebarBookmarkList.classList.add('foldup');
      li.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform') {
          let scrollTop = sidebarBookmarkList.scrollTop - 38;
          sidebarBookmarkList.removeChild(li);
          browser.bookmarks.remove(id).catch(error => logError('deleteBookmark', error));
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
          browser.bookmarks.remove(id).catch(error => logError('deleteBookmark', error));
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
// When using the add button in the panel, the panel renders a bookmark optimistically
// at the the top of the pile with an animation and sends a message to the service worker 
// to create the bookmark.
// If the bookmark already existed, the service worker will remove the original one.
async function addBookmark() {
  const tabs = await browser.tabs.query({active: true, currentWindow: true});
  const tab = tabs[0];
  if (!tab || tab.url.startsWith('about:')) {
    playCSSAnimation(addBookmarkButton, 'shaking', 'animation-shake-x');
    return;
  }
  if (optimisticElement) return; // guard against unlikely race condition
  if (sidebarBookmarkList.firstChild?.dataset.url === tab.url) {
    playCSSAnimation(addBookmarkButton, 'shaking', 'animation-shake-x');
    return;
  }
  optimisticElement = renderBookmark({ id: '', url: tab.url, title: tab.title });
  sidebarBookmarkList.prepend(optimisticElement);
  playCSSAnimation(sidebarBookmarkList, 'adding', 'animation-slidein');
  try {
    await browser.runtime.sendMessage({ type: 'ADD_BOOKMARK', tab: { url: tab.url, title: tab.title } });
  } catch(error) {
    logError('addBookmark', error);
    optimisticElement.remove();
    optimisticElement = null;
    playCSSAnimation(addBookmarkButton, 'shaking', 'animation-shake-x');
  }
}

// fold/unfold the search input field
function toggleSearch() {
  const cssClassShowSearchField = 'show-search-field';
  if (toolbar.classList.contains(cssClassShowSearchField)) {
    searchInputField.value = '';
    filterList('');
    toolbar.classList.remove(cssClassShowSearchField);
    playCSSAnimation(addBookmarkButton, 'hide-search-field', 'transition-button-add-large');
  } else {
    toolbar.classList.add(cssClassShowSearchField);
    searchInputField.focus();
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
/* ------------------------------------------------ */

function startCleanupMode() {
  cleanupMode = true;
  contentArea.classList.add('cleanup-mode');
  updateCleanupCounter();
}

function stopCleanupMode() {
  cleanupMode = false;
  contentArea.classList.remove('cleanup-mode');
}

function updateCleanupCounter() {
  const bookmarkCount = sidebarBookmarkList.children.length;
  const selectedCount = document.querySelectorAll('.selected').length;
  let cleanupCounterEl = document.querySelector('.cleanup-counter-selected');
  let cleanupCounterContextEl = document.querySelector('.cleanup-counter-context');
  let selectAllOrNoneEl = document.querySelector('.select-all-or-none-button');
  if (bookmarkCount === 0) {
    cleanupCounterEl.textContent = '';
    cleanupCounterContextEl.textContent = browser.i18n.getMessage("cleanedUp");
    selectAllOrNoneEl.classList.remove('none');
  } else {
    let ofLan = browser.i18n.getMessage("of");
    cleanupCounterEl.textContent = selectedCount;
    cleanupCounterContextEl.textContent = ` ${ofLan} ${bookmarkCount}`;
    if (selectedCount === bookmarkCount) {
      selectAllOrNoneEl.classList.add('none');
    } else {
      selectAllOrNoneEl.classList.remove('none');
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
    Promise.all(bookmarkIDs.map(id => browser.bookmarks.remove(id))).catch(error => logError('deleteSelectedBookmarks', error));
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
  searchInputField = document.querySelector('.search-input-field');
  toolbar = document.getElementById('toolbar');
  addBookmarkButton = document.querySelector('.add-bookmark');

  setTimeout(() => {
    document.body.classList.remove('no-animations');
  }, 650);

  searchStyle = document.createElement('style');
  document.head.appendChild(searchStyle);

  contentArea.addEventListener('click', (event) => {
    const fn = event.target.closest('[data-functionname]')?.dataset.functionname;
    switch (fn) {
      case 'addbookmark':
        if (toolbar.classList.contains('show-search-field')) {
          searchInputField.value = '';
          filterList('');
          searchInputField.focus();
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
        case 'selectbookmark': {
          const li = event.target.closest('li');
          li.classList.toggle('selected');
          li.querySelector('.cleanup-checkbox').checked = li.classList.contains('selected');
          updateCleanupCounter();
          return;
        }
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

  contentArea.addEventListener('contextmenu', function(e) {
    if (!e.target.classList.contains('link')) {
      e.preventDefault();
    }
  }, false);

  document.querySelectorAll('[data-localize-text]').forEach(el => {
    el.textContent = browser.i18n.getMessage(el.dataset.localizeText);
  });
  document.querySelectorAll('[data-localize-title]').forEach(el => {
    el.title = browser.i18n.getMessage(el.dataset.localizeTitle);
  });
  searchInputField.addEventListener('input', (e) => filterList(e.target.value));

  try {
    const obj = await browser.storage.local.get('pile-theme');
    if (obj['pile-theme']) changeTheme(obj['pile-theme']);
    const response = await browser.runtime.sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });
    pileFolderId = response.folderId;
    fullRebuild(response.bookmarks);
  } catch (error) {
    logError('init', error);
  }
}

init();
