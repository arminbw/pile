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

let myWindowId;
let openInActiveTab = false; // off by default: bookmarks open in a new tab; overwritten in init()


/* ------------------------------------------------ */
// Debugging
/* ------------------------------------------------ */

function logError(functionName, error) {
  console.error(`Pile panel error: ${functionName}, ${error}`);
}


/* ------------------------------------------------ */
// Opening bookmarks
/* ------------------------------------------------ */
// How a click on a bookmark plays out:
//   1. init() intercepts plain left-clicks on bookmark links. Modified clicks
//      (ctrl/cmd/shift, non-primary buttons) keep their normal browser meaning.
//   2. Unless the "open in active tab" option is on, openOrFocusBookmark()
//      first looks through this window's tabs for one already showing the
//      page, and switches to it instead of opening a duplicate.
//   3. Otherwise the URL is opened: in a new tab by default, or in the active
//      tab with the option on. Reusing the active tab never adds a tab, so
//      that mode needs no duplicate check: the click simply loads the page here.
//
// There is deliberately no state here: no tab tracking, no tab listeners.
// The browser already knows which tabs exist, so we ask it at the only moment
// the answer matters — the moment of the click. Nothing can go stale.
//
// Known limitation: a page that redirects (link shortener, consent page, login)
// leaves its tab on a URL that no longer matches the bookmark, so clicking that
// bookmark opens a duplicate instead of finding the redirected tab.

// Query parameters that identify the visit rather than the page.
// "utm_" matches as a prefix; the others must match the whole parameter name.
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|ref_src$)/;

// Two URLs can differ as text but still mean the same page: http vs https,
// a "www." prefix, a #fragment, a trailing slash, tracking parameters, query
// order. This boils a URL down to a comparison key with those differences
// removed. The key is only ever compared — never opened, shown, or stored —
// which is what makes the lossy rewriting safe. What actually gets opened is
// always the raw bookmark URL.
function normalizeUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./, '');
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    // Strip the trailing slash off the path, not the whole string, so it also
    // works when a query string follows ("/article/?p=2" vs "/article?p=2").
    // A bare root path is unaffected: the URL serializer restores its "/".
    u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch {
    return url; // not a parseable URL — compare it as plain text
  }
}

// Opens the bookmark's page fresh: in the active tab if the user chose that,
// otherwise in a new tab.
async function openBookmarkUrl(url) {
  if (openInActiveTab) {
    const [activeTab] = await browser.tabs.query({ active: true, windowId: myWindowId });
    return browser.tabs.update(activeTab.id, { url });
  }
  return browser.tabs.create({ url, windowId: myWindowId, active: true });
}

// Only this window's tabs count: the sidebar is per-window, and yanking the
// user to a different window would be more jarring than a duplicate tab.
// With "open in active tab" on there is nothing to look for — the user asked
// for pages to load right here, and reusing the active tab can't add a tab anyway.
async function openOrFocusBookmark(li) {
  const url = li.dataset.url;
  if (!openInActiveTab) {
    const key = normalizeUrl(url);
    const tabs = await browser.tabs.query({ windowId: myWindowId });
    const match = tabs.find(tab => normalizeUrl(tab.url) === key);
    if (match) return browser.tabs.update(match.id, { active: true });
  }
  return openBookmarkUrl(url);
}


/* ------------------------------------------------ */
// Highlighted bookmarks
/* ------------------------------------------------ */
// The user can highlight a bookmark via the right-click menu. The menu item
// itself is created once by the service worker; this page decides when the
// native menu shows only Pile's items (menus.overrideContext in init()),
// adjusts the item's wording to the row under the cursor (onShown), and
// performs the toggle (onClicked).
//
// The highlighted ids live in storage.local ("pile-highlighted"), keyed by
// bookmark id — a stable GUID in Firefox. The bookmarks themselves can't
// carry the flag: the WebExtension API exposes neither tags nor any custom
// metadata. A toggle only writes storage; the storage.onChanged listener
// below applies the change to the DOM, so every open sidebar (this one
// included) updates through the same path.

let highlightedIds = new Set();

async function toggleHighlight(li) {
  const id = li.dataset.bookmarkid;
  const next = new Set(highlightedIds);
  if (next.has(id)) next.delete(id); else next.add(id);
  await browser.storage.local.set({ 'pile-highlighted': [...next] });
}

// Written back only when ids actually disappeared, to avoid pointless writes.
function pruneHighlightedIds(bookmarks) {
  const existing = new Set(bookmarks.map(bookmark => bookmark.id));
  const pruned = [...highlightedIds].filter(id => existing.has(id));
  if (pruned.length === highlightedIds.size) return;
  highlightedIds = new Set(pruned);
  browser.storage.local.set({ 'pile-highlighted': pruned });
}

// The menu is about to show: name the action after the row's current state.
// update() + refresh() inside onShown is the documented way to change a menu
// that is already on screen.
//
// This registration runs at module load, before init() at the bottom of this
// file. It must never be able to throw here: an error at this point would
// abort the rest of the script and init() would never run, taking bookmark
// rendering down with it for what is otherwise an optional, additive
// feature. If browser.menus isn't available for any reason, the highlight
// feature is simply unavailable — everything else still works.
try {
  browser.menus.onShown.addListener(async (info) => {
    const li = browser.menus.getTargetElement(info.targetElementId)?.closest('li.bookmark');
    if (!li) return; // menu opened in another window's sidebar
    const key = highlightedIds.has(li.dataset.bookmarkid) ? 'unhighlightBookmark' : 'highlightBookmark';
    await browser.menus.update('toggle-highlight', { title: browser.i18n.getMessage(key) });
    browser.menus.refresh();
  });

  browser.menus.onClicked.addListener((info) => {
    if (info.menuItemId !== 'toggle-highlight') return;
    const li = browser.menus.getTargetElement(info.targetElementId)?.closest('li.bookmark');
    if (!li) return; // the click belonged to another window's sidebar
    toggleHighlight(li).catch(error => logError('toggleHighlight', error));
  });
} catch (error) {
  logError('menus setup', error);
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
  if (highlightedIds.has(bookmark.id)) li.classList.add('highlighted');
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
    if (highlightedIds.size > 0) {
      highlightedIds = new Set();
      browser.storage.local.set({ 'pile-highlighted': [] });
    }
    fullRebuild([]);
    return;
  }
  if (removeInfo.parentId !== pileFolderId) return;
  getBookmarkElement(id)?.remove();
  if (highlightedIds.has(id)) {
    highlightedIds.delete(id);
    browser.storage.local.set({ 'pile-highlighted': [...highlightedIds] });
  }
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
  // so lone bookmarks keep the shade of the neighboring block to minimize visual noise.
  //
  // The alternation is anchored at the BOTTOM of the list (the oldest session gets the
  // default shade) and walks upward. New sessions only ever appear at the top, so this
  // way a new session takes the next shade in the sequence while every existing block
  // keeps the color the user already knows it by. Anchored at the top, each new session
  // would flip the shade of everything below it — disorienting after every rebuild.
  const shades = [];
  let shaded = false;
  let seenQualifyingSession = false;
  for (let i = n - 1; i >= 0; i--) {
    const startsNewSession = i === n - 1 || sessionOf[i] !== sessionOf[i + 1];
    const qualifies = sizeOf[sessionOf[i]] >= MIN_SESSION_SIZE;
    if (startsNewSession && qualifies) {
      if (seenQualifyingSession) shaded = !shaded; // the oldest qualifying block keeps the default shade
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
  if (changes['pile-open-in-active-tab']) {
    openInActiveTab = changes['pile-open-in-active-tab'].newValue === true;
  }
  // Single source of truth for highlights: every sidebar (including the one
  // that made the change) applies the stored state to its rows from here.
  if (changes['pile-highlighted'] && sidebarBookmarkList) {
    highlightedIds = new Set(changes['pile-highlighted'].newValue ?? []);
    for (const li of sidebarBookmarkList.children) {
      li.classList.toggle('highlighted', highlightedIds.has(li.dataset.bookmarkid));
    }
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
  // firstElementChild, not firstChild: the whitespace text node between <ul>
  // and its first <li> in the HTML source has no .dataset and would throw.
  if (sidebarBookmarkList.firstElementChild?.dataset.url === tab.url) {
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

  // Right-click on a bookmark row: replace the browser's default menu with
  // Pile's own items (just "Highlight"). overrideContext only works when
  // called synchronously during the contextmenu event, which is why this
  // lives here and not with the menus listeners above. Elsewhere in the
  // sidebar chrome (toolbar, buttons) there is nothing a native context menu
  // (Inspect, Save Page As, ...) could usefully offer, so it stays suppressed
  // as it always has been.
  contentArea.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('li.bookmark')) {
      event.preventDefault();
      return;
    }
    try {
      browser.menus.overrideContext({ showDefaults: false });
    } catch (error) {
      logError('overrideContext', error);
    }
  });

  contentArea.addEventListener('click', (event) => {
    // A plain left-click on a bookmark link is Pile's to handle (see "Opening
    // bookmarks" at the top of this file). Modified clicks fall through to the
    // browser's own link behavior.
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

  document.querySelectorAll('[data-localize-text]').forEach(el => {
    el.textContent = browser.i18n.getMessage(el.dataset.localizeText);
  });
  document.querySelectorAll('[data-localize-title]').forEach(el => {
    el.title = browser.i18n.getMessage(el.dataset.localizeTitle);
  });
  searchInputField.addEventListener('input', (e) => filterList(e.target.value));

  try {
    myWindowId = (await browser.windows.getCurrent()).id;
    const obj = await browser.storage.local.get(['pile-theme', 'pile-open-in-active-tab', 'pile-session-enabled', 'pile-session-gap-hours', 'pile-highlighted']);
    if (obj['pile-theme']) changeTheme(obj['pile-theme']);
    openInActiveTab = obj['pile-open-in-active-tab'] === true;
    highlightedIds = new Set(obj['pile-highlighted'] ?? []);
    applySessionSettings(obj);
    const response = await browser.runtime.sendMessage({ type: 'GET_BOOKMARKS_AND_FOLDERID' });
    pileFolderId = response.folderId;
    pruneHighlightedIds(response.bookmarks); // drop ids of bookmarks deleted while no sidebar was open
    fullRebuild(response.bookmarks);
  } catch (error) {
    logError('init', error);
  }
}

init();
