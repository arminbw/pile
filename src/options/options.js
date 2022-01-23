

/* ------------------------------------------------ */
// write value into local storage
/* ------------------------------------------------ */
function storeThemeCSSName(newTheme) {
  browser.storage.local.set({
    'pile-theme': newTheme
  });
}


/* ------------------------------------------------ */
// update the menus in the options page
/* ------------------------------------------------ */
function updateOptionMenus() {

  function setCurrentChoice(result) {
    document.querySelector('#select-theme').value = result['pile-theme'] || 'theme-light';
  }

  function onError(error) {
    console.error(`Pile option error: ${error}`);
  }
    
  browser.storage.local.get('pile-theme').then(setCurrentChoice, onError);
}


/* ------------------------------------------------ */
// change theme of pile panel
/* ------------------------------------------------ */
function setTheme(e) {
   console.log(e);
   storeThemeCSSName(document.querySelector('#select-theme').value);
   // panel.js listens to storage.onChange events
}


async function correctOptionPageColors() {
  let theme = await browser.theme.getCurrent();
  if (theme.colors) {
    // TODO: deal with browser themes/OS themes (!); ask in forums
    console.log(theme.colors);
    document.querySelector('body').style.backgroundColor = theme.colors.button;
    document.querySelector('.testbla').style.backgroundColor = theme.colors.toolbar_bottom_separator;
  } else {
    console.log('no theme detected');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateOptionMenus();
  document.querySelector('#select-theme').addEventListener('change', setTheme);
  // correctOptionPageColors();
});
