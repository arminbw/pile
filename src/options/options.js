function updateOptionMenus() {
  function setCurrentChoice(result) {
    document.querySelector('#select-theme').value = result['pile-theme'] || 'theme-light';
    document.querySelector('#input-folder-name').value = result['pile-folder-name'] || '';
  }

  function onError(error) {
    console.error(`Pile option error: ${error}`);
  }

  browser.storage.local.get(['pile-theme', 'pile-folder-name']).then(setCurrentChoice, onError);
}

function setTheme() {
  browser.storage.local.set({
    'pile-theme': document.querySelector('#select-theme').value
  });
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
    feedbackEl.textContent = `A folder named "${newName}" already exists.`;
    feedbackEl.classList.add('error');
    return;
  }

  browser.storage.local.set({ 'pile-folder-name': value });
  feedbackEl.textContent = `Folder renamed to "${newName}".`;
  feedbackEl.classList.remove('error');
}

document.addEventListener('DOMContentLoaded', () => {
  updateOptionMenus();
  document.querySelector('#select-theme').addEventListener('change', setTheme);
  document.querySelector('#btn-save-folder-name').addEventListener('click', saveFolderName);
});
