function updateOptionMenus() {
  function setCurrentChoice(result) {
    document.querySelector('#select-theme').value = result['pile-theme'] || 'theme-light';
  }

  function onError(error) {
    console.error(`Pile option error: ${error}`);
  }

  browser.storage.local.get('pile-theme').then(setCurrentChoice, onError);
}

function setTheme() {
  browser.storage.local.set({
    'pile-theme': document.querySelector('#select-theme').value
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateOptionMenus();
  document.querySelector('#select-theme').addEventListener('change', setTheme);
});
