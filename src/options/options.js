function setTheme(e) {
  browser.storage.local.set({
    'pile-theme': document.querySelector('#select-theme').value
  });
}

function updateThemeSelectMenu() {

  function setCurrentChoice(result) {
    document.querySelector('#select-theme').value = result['pile-theme'] || 'theme-light';
  }

  function onError(error) {
    console.error(`Pile option error: ${error}`);
  }

  browser.storage.local.get('pile-theme').then(setCurrentChoice, onError);
}

async function correctOptionPageColors() {
  let theme = await browser.theme.getCurrent();
  if (theme.colors) {
    console.log(theme.colors);
    document.querySelector('body').style.backgroundColor = theme.colors.button;
    document.querySelector('.testbla').style.backgroundColor = theme.colors.toolbar_bottom_separator;
  } else {
    console.log('no theme detected');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeSelectMenu();
  document.querySelector('#select-theme').addEventListener('change', setTheme);
  correctOptionPageColors();
});
