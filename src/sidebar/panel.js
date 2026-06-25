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
let optimisticTabId, optimisticWindowId;

let myWindowId;
let openInNewTab = true; // default matches current confirmed behavior; overwritten in init()


/* ------------------------------------------------ */
// Debugging
/* ------------------------------------------------ */

function logError(functionName, error) {
  console.error(`Pile panel error: ${functionName}, ${error}`);
}


/* ------------------------------------------------ */
// Tab tracking — bookmarks already open in one of this window's tabs
/* ------------------------------------------------ */

let trackedTabs = new Map();        // bookmarkId -> { tabId, windowId }
let tabIdToBookmarkId = new Map();  // tabId -> bookmarkId  (reverse lookup for cleanup)

function trackTab(bookmarkId, tabId, windowId) {
  trackedTabs.set(bookmarkId, { tabId, windowId });
  tabIdToBookmarkId.set(tabId, bookmarkId);
}

// Used whenever a tabId stops being "ours": tab closed, navigated away, detached to
// another window, or about to be claimed for a different bookmark.
function untrackByTabId(tabId) {
  const bookmarkId = tabIdToBookmarkId.get(tabId);
  if (!bookmarkId) return;
  tabIdToBookmarkId.delete(tabId);
  trackedTabs.delete(bookmarkId);
  getBookmarkElement(bookmarkId)?.classList.remove('is-open');
}

// Used when the bookmark itself goes away or its URL changes underneath the tracked tab.
function untrackByBookmarkId(bookmarkId) {
  const tracked = trackedTabs.get(bookmarkId);
  if (!tracked) return;
  trackedTabs.delete(bookmarkId);
  tabIdToBookmarkId.delete(tracked.tabId);
  getBookmarkElement(bookmarkId)?.classList.remove('is-open');
}

function normalizeUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

async function seedTrackedTabs(bookmarks) {
  const tabs = await browser.tabs.query({ windowId: myWindowId });
  const tabByUrl = new Map(); // normalizedUrl -> tab; first match wins if duplicates are open
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    if (!tabByUrl.has(key)) tabByUrl.set(key, tab);
  }
  for (const bookmark of bookmarks) {
    const tab = tabByUrl.get(normalizeUrl(bookmark.url));
    if (tab) trackTab(bookmark.id, tab.id, tab.windowId);
  }
}

async function openBookmarkUrl(url) {
  if (openInNewTab) {
    return browser.tabs.create({ url, windowId: myWindowId, active: true });
  }
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  return browser.tabs.update(activeTab.id, { url });
}

async function openOrFocusBookmark(li) {
  const bookmarkId = li.dataset.bookmarkid;
  const tracked = trackedTabs.get(bookmarkId);

  if (tracked) {
    try {
      await browser.tabs.update(tracked.tabId, { active: true });
      const win = await browser.windows.get(tracked.windowId);
      await browser.windows.update(tracked.windowId, {
        focused: true,
        ...(win.state === 'minimized' ? { state: 'normal' } : {}),
      });
      return;
    } catch {
      // tab/window no longer exists; fall through and open below
      untrackByTabId(tracked.tabId);
    }
  }

  const tab = await openBookmarkUrl(li.dataset.url);
  untrackByTabId(tab.id); // evicts a stale owner when openInNewTab is false; no-op otherwise
  trackTab(bookmarkId, tab.id, tab.windowId);
  li.classList.add('is-open');
}

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo.windowId !== myWindowId) return;
  untrackByTabId(tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.windowId !== myWindowId || !changeInfo.url) return;
  const bookmarkId = tabIdToBookmarkId.get(tabId);
  if (!bookmarkId) return;
  const li = getBookmarkElement(bookmarkId);
  if (normalizeUrl(changeInfo.url) === normalizeUrl(li?.dataset.url)) return; // same page (hash/trailing-slash change)
  untrackByTabId(tabId);
});

// Tab dragged to another window: once detached, this tab is no longer "ours" —
// the destination window's panel (if any) has no record of it either, so just drop tracking.
browser.tabs.onDetached.addListener((tabId, detachInfo) => {
  if (detachInfo.oldWindowId !== myWindowId) return;
  untrackByTabId(tabId);
});


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
  if (trackedTabs.has(bookmark.id)) li.classList.add('is-open');
  let a = document.createElement('a');
  a.classList.add('link');
  a.setAttribute('href', bookmark.url);
  a.appendChild(document.createTextNode(bookmark.title));
  let openIndicator = document.createElement('span');
  openIndicator.classList.add('open-indicator');
  openIndicator.setAttribute('title', browser.i18n.getMessage('openInTab'));
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
  li.appendChild(openIndicator);
  li.appendChild(button);
  li.appendChild(checkboxBorderWrapper);
  return li;
}


/* ------------------------------------------------ */
// Bookmark event listeners
/* ------------------------------------------------ */

browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (bookmark.parentId !== pileFolderId) return;
  if (!bookmark.url) return;
  if (optimisticElement && bookmark.url === optimisticElement.dataset.url) {
    optimisticElement.setAttribute('data-bookmarkid', id);
    if (optimisticTabId) {
      trackTab(id, optimisticTabId, optimisticWindowId);
      optimisticElement.classList.add('is-open');
    }
    optimisticElement = optimisticTabId = optimisticWindowId = undefined;
  } else {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab && normalizeUrl(activeTab.url) === normalizeUrl(bookmark.url)) {
      trackTab(id, activeTab.id, activeTab.windowId);
    }
    sidebarBookmarkList.prepend(renderBookmark(bookmark));
  }
});

browser.bookmarks.onRemoved.addListener((id, removeInfo) => {
  if (id === pileFolderId) {
    pileFolderId = null;
    trackedTabs.clear();
    tabIdToBookmarkId.clear();
    fullRebuild([]);
    return;
  }
  if (removeInfo.parentId !== pileFolderId) return;
  getBookmarkElement(id)?.remove();
  untrackByBookmarkId(id);
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
    untrackByBookmarkId(id);
  }
});

browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  const newParentIsPile = moveInfo.parentId === pileFolderId;
  const oldParentWasPile = moveInfo.oldParentId === pileFolderId;
  if (!newParentIsPile && !oldParentWasPile) return;

  const li = getBookmarkElement(id);
  li?.remove();
  if (oldParentWasPile && !newParentIsPile) untrackByBookmarkId(id); // left the Pile folder entirely

  if (newParentIsPile) {
    const el = li ?? renderBookmark((await browser.bookmarks.get(id))[0]);
    sidebarBookmarkList.insertBefore(el, sidebarBookmarkList.children[moveInfo.index] ?? null);
  }
});


/* ------------------------------------------------ */
// Update the list of Pile bookmarks in the panel
/* ------------------------------------------------ */

const MIN_SESSION_SIZE = 2; // a lone bookmark doesn't get a different shade

// Configurable via the options page (see applySessionSettings). Defaults: sessions on,
// bookmarks added more than 2h apart belong to different browsing sessions.
let sessionsEnabled = true;
let sessionGapMs = 2 * 60 * 60 * 1000;

function applySessionSettings(values) {
  if (values['pile-session-enabled'] !== undefined) sessionsEnabled = values['pile-session-enabled'];
  const hours = values['pile-session-gap-hours'];
  if (typeof hours === 'number' && hours > 0) sessionGapMs = hours * 60 * 60 * 1000;
}

// Returns - per bookmark - a 0 or 1 for the alternating background
// and an "end" flag for the divider on the last row of a session
function assignSessionInfo(bookmarks) {
  if (!sessionsEnabled) return { shades: [], ends: [] }; // feature off: no shading, no dividers
  const n = bookmarks.length;

  // Group bookmarks into sessions
  const sessionOf = []; // sessionOf[i] is the session number of bookmarks[i]
  const sizeOf = [];    // sizeOf[s] is the number of bookmarks in session s
  for (let i = 0, session = 0; i < n; i++) {
    if (i > 0 && bookmarks[i - 1].dateAdded - bookmarks[i].dateAdded > sessionGapMs) session++;
    sessionOf[i] = session;
    sizeOf[session] = (sizeOf[session] ?? 0) + 1;
  }

  // The shade alternates between sessions, but only sessions of MIN_SESSION_SIZE+ flip it,
  // so lone bookmarks keep the shade of the block above to minimize visual noise.
  const shades = [];
  let shaded = false;
  let seenQualifyingSession = false;
  for (let i = 0; i < n; i++) {
    const startsNewSession = i === 0 || sessionOf[i] !== sessionOf[i - 1];
    const qualifies = sizeOf[sessionOf[i]] >= MIN_SESSION_SIZE;
    if (startsNewSession && qualifies) {
      if (seenQualifyingSession) shaded = !shaded; // the first qualifying block keeps the default shade
      seenQualifyingSession = true;
    }
    shades[i] = shaded;
  }

  // A divider marks the last row of each shaded block — where the shade is about to change.
  const ends = shades.map((shade, i) => i === n - 1 || shades[i + 1] !== shade);

  return { shades, ends };
}

function fullRebuild(bookmarks) {
  // render an array of all bookmarks
  // the use spread operator to turn them into individual arguments for replaceChildren
  const { shades, ends } = assignSessionInfo(bookmarks);
  const elements = bookmarks.map((bookmark, i) => {
    const li = renderBookmark(bookmark);
    if (shades[i]) li.classList.add('session-b');
    if (ends[i]) li.classList.add('session-end');
    return li;
  });
  sidebarBookmarkList.replaceChildren(...elements);
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
  if (changes['pile-open-in-new-tab']) {
    openInNewTab = changes['pile-open-in-new-tab'].newValue !== false;
  }
  if (changes['pile-session-enabled'] || changes['pile-session-gap-hours']) {
    applySessionSettings({
      'pile-session-enabled': changes['pile-session-enabled']?.newValue,
      'pile-session-gap-hours': changes['pile-session-gap-hours']?.newValue,
    });
    browser.runtime.sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' })
      .then((response) => fullRebuild(response.bookmarks))
      .catch((error) => logError('applySessionSettings', error));
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
  optimisticTabId = tab.id;
  optimisticWindowId = tab.windowId;
  sidebarBookmarkList.prepend(optimisticElement);
  playCSSAnimation(sidebarBookmarkList, 'adding', 'animation-slidein');
  try {
    await browser.runtime.sendMessage({ type: 'ADD_BOOKMARK', tab: { url: tab.url, title: tab.title } });
  } catch(error) {
    logError('addBookmark', error);
    optimisticElement.remove();
    optimisticElement = optimisticTabId = optimisticWindowId = undefined;
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
  sidebarBookmarkList.classList.toggle('is-filtered', !!terms);
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
    const linkEl = event.target.closest('.link');
    if (linkEl && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      openOrFocusBookmark(linkEl.closest('li')).catch(error => logError('openOrFocusBookmark', error));
      return;
    }

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
    myWindowId = (await browser.windows.getCurrent()).id;
    const obj = await browser.storage.local.get(['pile-theme', 'pile-open-in-new-tab', 'pile-session-enabled', 'pile-session-gap-hours']);
    if (obj['pile-theme']) changeTheme(obj['pile-theme']);
    openInNewTab = obj['pile-open-in-new-tab'] !== false;
    applySessionSettings(obj);
    const response = await browser.runtime.sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });
    pileFolderId = response.folderId;
    await seedTrackedTabs(response.bookmarks);
    fullRebuild(response.bookmarks);
  } catch (error) {
    logError('init', error);
  }
}

init();
