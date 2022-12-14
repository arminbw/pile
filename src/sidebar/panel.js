'use strict';

let myWindowId;
let backgroundscript;
let sidebarBookmarkList;
let contentArea;
let searchStyle;
let themeCSSName;

// every panel gets the html list of all bookmarks from the backgroundscript
// to prevent unnecessary updates, we use a counter 
// the updateCounter gets incremented every time something is changed
let updateCounter = 0;

// when the user clicks on the trashcan in the sidebar, cleanupMode is set to true
let cleanupMode = false;


/* ------------------------------------------------ */
// Debugging
/* ------------------------------------------------ */

function logError(functionName, error) {
  console.error(`Pile panel error: ${functionName}, ${error}`);
}


/* ------------------------------------------------ */
// UI event listeners
/* ------------------------------------------------ */

window.addEventListener('click', (event) => {
  if (event.which === 1) {
    const fn = event.target.dataset.functionname;
    console.log(fn);
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
    }

    if (cleanupMode) {
      switch (fn) {
        case 'selectbookmark':
          // highlight bookmark when checkbox is clicked
          event.target.parentElement.parentElement.classList.toggle('selected');
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

    // delete bookmark when close button is clicked
    if (event.target.dataset.deleteid) {
      deleteBookmark(event.target.dataset.deleteid);
      return;
    }
  }
});

document.querySelector('.search-input-field').addEventListener('input', (e) => {
  filterList(e.target.value)
});

// if a tab is activated (e.g. by switching/closing tabs),
// check if a content update is necessary
// TODO: is this really necessary?
browser.tabs.onActivated.addListener((activatedTab) => {
  if (activatedTab.windowId !== myWindowId) {
    updateBookmarkListElement();
  }
});


/* ------------------------------------------------ */
// Update the list of Pile bookmarks in the panel
/* ------------------------------------------------ */

// get the latest html representation of the bookmarks,
// but only if any changes happened
function updateBookmarkListElement() {
  console.log(`panel of window ${myWindowId} compares updateCounter: panel ${updateCounter} background ${backgroundscript.updateCounter}`);
  if (updateCounter < backgroundscript.updateCounter) {
    console.log(`panel of window ${myWindowId}: something to update`);
    sidebarBookmarkList = document.querySelector('ul.bookmarks');
    contentArea.replaceChild(backgroundscript.bookmarkListElement.cloneNode(true), sidebarBookmarkList);
    sidebarBookmarkList = document.querySelector('ul.bookmarks'); // needed
    updateCounter = backgroundscript.updateCounter;
    if (cleanupMode) updateCleanupCounter();
  } else {
    console.log(`panel of window ${myWindowId}: no need to update`);
  }

  // (re-)adjust scrollbar offset
  let scrollbarWidth = sidebarBookmarkList.offsetWidth - sidebarBookmarkList.clientWidth + 14;
  let widthCSS = `calc(100% + ${scrollbarWidth}px)`;
  sidebarBookmarkList.style.width = widthCSS; 
}

function handleMessage(request, sender, sendResponse) {
  // TODO: add proper error handling
  console.log(`panel of window ${myWindowId} received message: ${request.message}`);
  if (request.message === 'updatePilePanel') {
     // The timeout allows the CSS transition to end before
     // the background updates the list because of a double
     setTimeout(() => {
       updateBookmarkListElement();
     }, 380);
  };
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


/*async function getBrowserTheme() {
  const newTheme = await browser.theme.getCurrent();
  console.log(newTheme);
}
getBrowserTheme();*/


/* ------------------------------------------------ */
// Sidebar user interaction
/* ------------------------------------------------ */

// delete a bookmark and show an animation
// do not rebuild the whole list
function deleteBookmark(id) {
  if (id) {
    console.log(`panel of window ${myWindowId} deleting ${id}`);
    let li = getBookmarkElement(id);
    li.classList.add('being-deleted');
    updateCounter++;
    // can the user scroll? (scrollHeight > offsetHeight)
    // only do the foldup if:
    // * the user can scroll
    // * the user reached the bottom of the list
    let scrollablePart = sidebarBookmarkList.scrollHeight - sidebarBookmarkList.offsetHeight;
    let distanceToBottom = scrollablePart - sidebarBookmarkList.scrollTop;
    if ((sidebarBookmarkList.scrollTopMax > 38) && (distanceToBottom < 38)) {
      sidebarBookmarkList.classList.add('foldup');
      li.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform') {
          let scrollTop = sidebarBookmarkList.scrollTop - 38;
          sidebarBookmarkList.removeChild(li);
          backgroundscript.removeBookmark(id);
          sidebarBookmarkList.classList.remove('foldup');
          sidebarBookmarkList.scrollTo(0,scrollTop);
        }
      }, false);
    } else {  
      if ((sidebarBookmarkList.scrollTop > 0) && (distanceToBottom < 38)) {
        // edge case: list is scrollable, but not after the deletion
        // and user has scrolled down a bit
        // solution: scroll to the top
        sidebarBookmarkList.scrollTo(0,0);
      }
      li.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform') {
          sidebarBookmarkList.removeChild(li);
          backgroundscript.removeBookmark(id);
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
// add the class cssClass to htmlElement and remove it when played once
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
// do not rebuild the whole list
async function addBookmark() {
  const tabs = await browser.tabs.query({active: true, currentWindow: true})
  // check if the page is already bookmarked and on top of the Pile
  if (sidebarBookmarkList.firstChild !== null) {
    const topEntry = sidebarBookmarkList.firstChild;
    if (tabs[0].url === topEntry.firstChild.href) {
      playCSSAnimation(topEntry, 'shaking', 'animation-shake-y');
      return;
    }
  }
  if (tabs[0].url !== false) {
    try {
      const newBookmark = await backgroundscript.addBookmark(tabs[0]);
      updateCounter++;
      const renderedBookmark = backgroundscript.renderBookmark(newBookmark);
      playCSSAnimation(sidebarBookmarkList, 'adding', 'animation-slidein');
      sidebarBookmarkList.prepend(renderedBookmark);
    } catch(error) {
      logError('addBookmark/render', error);
      const errorHtmlElement = document.querySelector('.add-bookmark');
      playCSSAnimation(errorHtmlElement, 'shaking', 'animation-shake-x');
    }
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

// hackish search/filter functionality (don’t try this at home!)
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

// switch to cleanup mode
// cleanup mode allows the user to select multiple bookmarks
// and then delete them with one click
function startCleanupMode() {
  cleanupMode = true;
  document.getElementById('content').classList.add('cleanup-mode');
  updateCleanupCounter();
}

// switch back from cleanup mode
function stopCleanupMode() {
  cleanupMode = false;
  document.getElementById('content').classList.remove('cleanup-mode');
}

// show the number of selectable and selected bookmarks in cleanup mode
function updateCleanupCounter() {
  const bookmarkCount = sidebarBookmarkList.children.length;
  const selectedCount = document.querySelectorAll('.selected').length;
  let cleanupCounterEl =  document.querySelector('.cleanup-counter-selected');
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

// select all bookmarks in cleanup mode
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

// deselect all bookmarks in cleanup mode
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

// delete all bookmarks that have been selected in cleanup mode
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
    backgroundscript.removeBookmarks(bookmarkIDs);
    if ((selectedNodes.length) === (sidebarBookmarkList.children.length)) {
      stopCleanupMode();
    };
  }
}



/* ------------------------------------------------ */
// Initialization
/* ------------------------------------------------ */

async function init() {
  // When the sidebar loads, get the ID of its window and fetch the content.
  let windowInfo = await browser.windows.getCurrent({populate: true});
  console.log(windowInfo);
  myWindowId = windowInfo.id;
  sidebarBookmarkList = document.querySelector('ul.bookmarks');
  contentArea = document.querySelector('#content');

  // the noanimations css class temporarily suppresses all animations after page load
  setTimeout(() => {
    document.body.classList.remove('no-animations');
  }, 650);

  // change the theme
  browser.storage.local.get('pile-theme').then((obj) => { 
    console.log(obj);
    changeTheme(obj['pile-theme']);
  }, logError);

  // create a new stylesheet for the search/filter (see filterList())
  searchStyle = document.createElement('style');
  searchStyle.appendChild(document.createTextNode(''));
  document.head.appendChild(searchStyle);

  // remove right click context menu from add button and blank content area
  contentArea.addEventListener('contextmenu', function(e) {
    if (e.target.className !== 'link') {
      e.preventDefault();
    }
  }, false);

  // localization of basic ui elements
  document.querySelectorAll('[data-localize-text]').forEach(el => {
    el.textContent = browser.i18n.getMessage(el.dataset.localizeText);
  });
  document.querySelectorAll('[data-localize-title]').forEach(el => {
    console.log(el.dataset.localizeText);
    el.title = browser.i18n.getMessage(el.dataset.localizeTitle);
  });
  document.querySelector('.search-input-field').textContent = browser.i18n.getMessage('search');

  // register message handler
  browser.runtime.onMessage.addListener(handleMessage);
  console.log(`panel of window ${myWindowId} ready: waiting for a first update`);

  // get the backgroundscript and update the bookmark list
  backgroundscript = await browser.runtime.getBackgroundPage();
  updateBookmarkListElement();
  // if the backgroundscript is still building its list, just wait for the update message
}

init();
