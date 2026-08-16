const DEFAULT_SESSION_GAP_HOURS = 2;

// Same mechanism as the sidebar (see panel.js): elements carry the message key
// in a data attribute, and this pass fills in the user's language on load.
function localizePage() {
  document.title = browser.i18n.getMessage('optionsTitle');
  document.querySelectorAll('[data-localize-text]').forEach(el => {
    el.textContent = browser.i18n.getMessage(el.dataset.localizeText);
  });
}

function updateOptionMenus() {
  function setCurrentChoice(result) {
    document.querySelector('#select-theme').value = result['pile-theme'] || 'theme-light';
    document.querySelector('#input-folder-name').value = result['pile-folder-name'] || '';

    const enabled = result['pile-session-enabled'] !== false; // sessions are on by default
    document.querySelector('#checkbox-session-enabled').checked = enabled;
    const gapInput = document.querySelector('#input-session-gap');
    gapInput.value = result['pile-session-gap-hours'] || DEFAULT_SESSION_GAP_HOURS;
    gapInput.disabled = !enabled;

    document.querySelector('#checkbox-open-in-active-tab').checked = result['pile-open-in-active-tab'] === true; // off by default
  }

  function onError(error) {
    console.error(`Pile option error: ${error}`);
  }

  browser.storage.local
    .get(['pile-theme', 'pile-folder-name', 'pile-session-enabled', 'pile-session-gap-hours', 'pile-open-in-active-tab'])
    .then(setCurrentChoice, onError);
}

function setTheme() {
  browser.storage.local.set({
    'pile-theme': document.querySelector('#select-theme').value
  });
}

function setSessionEnabled() {
  const enabled = document.querySelector('#checkbox-session-enabled').checked;
  document.querySelector('#input-session-gap').disabled = !enabled;
  browser.storage.local.set({ 'pile-session-enabled': enabled });
}

function setSessionGap() {
  const input = document.querySelector('#input-session-gap');
  let hours = parseInt(input.value, 10);
  if (isNaN(hours) || hours < 1) hours = 1;
  if (hours > 168) hours = 168;
  input.value = hours;
  browser.storage.local.set({ 'pile-session-gap-hours': hours });
}

function setOpenInActiveTab() {
  browser.storage.local.set({ 'pile-open-in-active-tab': document.querySelector('#checkbox-open-in-active-tab').checked });
}

async function saveFolderName() {
  const value = document.querySelector('#input-folder-name').value.trim();
  const newName = value || 'Pile';
  const feedbackEl = document.querySelector('#folder-name-error');

  const stored = await browser.storage.local.get('pile-folder-name');
  const currentName = (stored['pile-folder-name'] || '').trim() || 'Pile';

  if (newName === currentName) return;

  const existing = await browser.bookmarks.search({ title: newName });
  if (existing.some(b => b.type === 'folder')) {
    feedbackEl.textContent = browser.i18n.getMessage('folderExists', newName);
    feedbackEl.classList.add('error');
    return;
  }

  browser.storage.local.set({ 'pile-folder-name': value });
  feedbackEl.textContent = browser.i18n.getMessage('folderRenamed', newName);
  feedbackEl.classList.remove('error');
}

document.addEventListener('DOMContentLoaded', () => {
  localizePage();
  updateOptionMenus();
  document.querySelector('#select-theme').addEventListener('change', setTheme);
  document.querySelector('#btn-save-folder-name').addEventListener('click', saveFolderName);
  document.querySelector('#checkbox-session-enabled').addEventListener('change', setSessionEnabled);
  document.querySelector('#input-session-gap').addEventListener('change', setSessionGap);
  document.querySelector('#checkbox-open-in-active-tab').addEventListener('change', setOpenInActiveTab);
});
