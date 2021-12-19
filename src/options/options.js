function setTheme(e) {
  // e.preventDefault();
  console.log('setting theme');
  console.log(document.querySelector('#select-theme').value);
  browser.storage.local.set({
    'pile-theme': document.querySelector('#select-theme').value
  });
}

function restoreOptions() {

  function setCurrentChoice(result) {
    document.querySelector('#select-theme').value = result.theme || 'light';
  }

  function onError(error) {
    console.log(`Error: ${error}`);
  }

  let getting = browser.storage.local.get('pile-theme');
  getting.then(setCurrentChoice, onError);
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  document.querySelector('#select-theme').addEventListener('onChange', setTheme);
});
