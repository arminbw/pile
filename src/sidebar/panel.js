"use strict";

let myWindowId;
let backgroundscript;
let sidebarBookmarkList;
let contentArea;
let searchStyle;

// every panel gets the html list of all bookmarks from the backgroundscript
// to prevent unnecessary updates, we use a counter 
// the counter gets incremented every time something is changed
let updateCounter = 0;


/* ------------------------------------------------ */
// Debugging
/* ------------------------------------------------ */

function logError(functionName, error) {
  console.error(`Pile panel error: ${functionName}, ${error}`);
}


/* ------------------------------------------------ */
// Event listeners
/* ------------------------------------------------ */

window.addEventListener("click", (event) => {
  if (event.which === 1) {
    // delete bookmark by clicking on its close button
    if (event.target.dataset.deleteid) {
      deleteBookmark(event.target.dataset.deleteid);
      return;
    }
    // add bookmark by clicking on the add button
    if (event.target.dataset.functionname === "addbookmark") {
      // clear search before adding
      if (document.getElementById('toolbar').classList.contains("showsearchfield")) {
        document.getElementById('searchinputfield').value = "";
        filterList("");
        document.getElementById('searchinputfield').focus();
      }
      addBookmark();
      return;
    }
    // fold or unfold the searchfield
    if (event.target.dataset.functionname === "togglesearch") {
      toggleSearch();
      return;
    }
    // switch to delete-all mode
    if (event.target.dataset.functionname === "startcleanup") {
      startCleanupMode();
      return;
    }
  }
});

document.getElementById('searchinputfield').addEventListener('input', (e) => {
  filterList(e.target.value)
});

// if a tab is activated (e.g. by switching/closing tabs),
// check if a content update is necessary, then update the content
// TODO: really necessary?
browser.tabs.onActivated.addListener((activatedTab) => {
  if (activatedTab.windowId !== myWindowId) {
    updateBookmarkListNode();
  }
});


/* ------------------------------------------------ */
// Update the list of pile bookmarks in the panel
/* ------------------------------------------------ */

// get the latest html representation of the bookmarks,
// but only if any changes happened
function updateBookmarkListNode() {
  console.log(`panel of window ${myWindowId} compares updateCounter: panel ${updateCounter} background ${backgroundscript.updateCounter}`);
  if (updateCounter < backgroundscript.updateCounter) {
    console.log(`panel of window ${myWindowId}: something to update`);
    sidebarBookmarkList = document.getElementById("bookmarklist");
    contentArea.replaceChild(backgroundscript.bookmarkListNode.cloneNode(true), sidebarBookmarkList);
    sidebarBookmarkList = document.querySelector("#bookmarklist");
      // TODO: Experimental drag&drop event listeners
      for (let li of sidebarBookmarkList.children) {
        li.setAttribute("draggable", "true");
        li.setAttribute("dragstart", function() { li.classList.add("dragged") });
        li.setAttribute("dragover", () => { console.log("Blo");});
        // console.log(li);
      }
      // console.log(sidebarBookmarkList);
  
    updateCounter = backgroundscript.updateCounter;
  } else {
    console.log(`panel of window ${myWindowId}: no need to update`);
  }

  // (re-)adjust scrollbar offset
  let scrollbarWidth = sidebarBookmarkList.offsetWidth - sidebarBookmarkList.clientWidth + 14;
  let widthCSS = `calc(100% + ${scrollbarWidth}px)`;
  sidebarBookmarkList.style.width = widthCSS; 
}

function handleMessage(request, sender, sendResponse) {
  // TODO: add error handling, etc.
  console.log(`panel of window ${myWindowId} received message: ${request.message}`);
  if (request.message === "updatePilePanel") {
     // The timeout allows the css transition to end before
     // the background does update the list because of a double
     setTimeout(() => {
       updateBookmarkListNode();
     }, 380);
  }
}


/* ------------------------------------------------ */
// Sidebar user interaction
/* ------------------------------------------------ */

// delete a bookmark and show an animation
// do not rebuild the whole list
function deleteBookmark(id) {
  if (id) {
    console.log(`panel of window ${myWindowId} deleting ${id}`);
    let li = getBookmarkListElement(id);
    li.classList.add("beingdeleted");
    updateCounter++;
    // can the user scroll? (scrollHeight > offsetHeight)
    // only do the foldup if:
    // * the user can scroll
    // * the user reached the bottom of the list
    let scrollablePart = sidebarBookmarkList.scrollHeight - sidebarBookmarkList.offsetHeight;
    let distanceToBottom = scrollablePart - sidebarBookmarkList.scrollTop;
    if ((sidebarBookmarkList.scrollTopMax > 38) && (distanceToBottom < 38)) {
      sidebarBookmarkList.classList.add("foldup");
      li.addEventListener("transitionend", (event) => {
        if (event.propertyName === "transform") {
          let scrollTop = sidebarBookmarkList.scrollTop - 38;
          sidebarBookmarkList.removeChild(li);
          backgroundscript.removeBookmark(id);
          sidebarBookmarkList.classList.remove("foldup");
          sidebarBookmarkList.scrollTo(0,scrollTop);
        }
      }, false);
    } else {  
      if ((sidebarBookmarkList.scrollTop > 0) && (distanceToBottom < 38)) {
        // edge case:
        // list is scrollable, but not after the deletion
        // and user has scrolled down a bit
        // solution: scroll to the top
        sidebarBookmarkList.scrollTo(0,0);
      }
      li.addEventListener("transitionend", (event) => {
        if (event.propertyName === "transform") {
          sidebarBookmarkList.removeChild(li);
          backgroundscript.removeBookmark(id);
        }
      }, false);
    }
  }
}

// helper for deleteBookmark
function getBookmarkListElement(bookmarkid) {
  for (let li of sidebarBookmarkList.getElementsByClassName("bookmark")) {
      if (li.dataset.bookmarkid === bookmarkid) return li;
  }
}

// play a css animation once
// add the class cssClass to htmlElement and remove it when played once
function playCssAnimation(htmlElement, cssClass, animationName) {
  htmlElement.classList.add(cssClass);
  console.log("playing css animation");
  let stopAnimation = function(event) {
    if (event.animationName === animationName) {
      htmlElement.classList.remove(cssClass);
      htmlElement.removeEventListener("animationend", stopAnimation);
    }
  }
  htmlElement.addEventListener("animationend", stopAnimation, false);
}

// add a bookmark and show an animation
// do not rebuild the whole list
async function addBookmark() {
  let tabs = await browser.tabs.query({active: true, currentWindow: true})
  // check if the page is already bookmarked and on top of the pile
  if (sidebarBookmarkList.firstChild !== null) {
    let topEntry = sidebarBookmarkList.firstChild;
    if (tabs[0].url === topEntry.firstChild.href) {
      playCssAnimation(topEntry, "shaking", "shake");
      return;
    }
  }
  if (tabs[0].url !== false) {
    updateCounter++;
    try {
      let newbookmark = await backgroundscript.addBookmark(tabs[0]);
      let bookmarkNode = backgroundscript.createBookmarkNode(newbookmark);
      playCssAnimation(sidebarBookmarkList, "adding", "slidein");
      sidebarBookmarkList.prepend(bookmarkNode);
    } catch(error) {
      logError("addBookmark/create", error);
      console.log('shaking');
      // TODO: no shake. css class seems to have low priority
      let errorHtmlElement = document.getElementById('addbookmark');
      playCssAnimation(errorHtmlElement, "shaking", "addbuttonshake");
    };
  }
}

// fold/unfold the search input field
function toggleSearch() {
  const toolbar = document.getElementById('toolbar');
  const cssIDshowSearchField = "showsearchfield"; 
  if (toolbar.classList.contains(cssIDshowSearchField)) {
    document.getElementById('searchinputfield').value = "";
    filterList("");
    toolbar.classList.remove(cssIDshowSearchField);
  } else {
    toolbar.classList.add(cssIDshowSearchField);
    document.getElementById('searchinputfield').focus();
  }
}

// hackish search/filter functionality (don't try this at home!)
function filterList(terms) {
  if (searchStyle.sheet.cssRules.length > 1) {
    searchStyle.sheet.deleteRule(0);
    searchStyle.sheet.deleteRule(0);
  }
  if (!terms) return;
  const searchTerms = terms.toLowerCase().split(" ");
  let rules = searchTerms.reduce((accumulator, term) => {
    if (term !== "") accumulator += "[data-title*=\"" + term + "\"]";
    return accumulator;
  }, "li.bookmark");
  rules += " { display: flex; }";
  searchStyle.sheet.insertRule(rules);
  searchStyle.sheet.insertRule("li.bookmark { display: none; }");
}

// switch to cleanup mode
function startCleanupMode() {
  console.log("cleanup mode");
  const content = document.getElementById('content');
  content.classList.add("cleanupmode");
}


/* ------------------------------------------------ */
// Initialization
/* ------------------------------------------------ */

async function init() {
  // When the sidebar loads, get the ID of its window and fetch the content.
  let windowInfo = await browser.windows.getCurrent({populate: true});
  console.log(windowInfo);
  myWindowId = windowInfo.id;
  sidebarBookmarkList = document.querySelector("#bookmarklist");
  contentArea = document.querySelector("#content");

  // the noanimations css class temporarily suppresses all animations after page load
  setTimeout(() => {
    document.body.className="";
  }, 650);

  // create a new stylesheet for the search/filter (see filterList())
  searchStyle = document.createElement("style");
  searchStyle.appendChild(document.createTextNode(""));
  document.head.appendChild(searchStyle);

  // remove right click context menu from add button and blank content area
  contentArea.addEventListener("contextmenu", function(e) {
    if (e.target.className !== "link") {
      e.preventDefault();
    }
  }, false);

  // register message handler
  browser.runtime.onMessage.addListener(handleMessage);
  console.log(`panel of window ${myWindowId} ready: waiting for a first update`);

  // get the backgroundscript and update the bookmark list
  backgroundscript = await browser.runtime.getBackgroundPage();
  updateBookmarkListNode();
  // if the backgroundscript is still building its list, just wait for the update message
}

init();