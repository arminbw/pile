// @vitest-environment jsdom
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, test, expect, vi } from 'vitest';
import { createBrowserMock } from './mocks/browser.js';

const optionsHTML = readFileSync(resolve('src/options/options.html'), 'utf-8');

let browser;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function initOptions() {
  document.documentElement.innerHTML = optionsHTML;
  await import('../src/options/options.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await flushPromises();
}

beforeEach(() => {
  vi.resetModules();
  browser = createBrowserMock();
  global.browser = browser;
});


describe('Options page - folder name', () => {
  test('shows stored folder name in input on init', async () => {
    await browser.storage.local.set({ 'pile-folder-name': 'Reading List' });
    await initOptions();

    expect(document.querySelector('#input-folder-name').value).toBe('Reading List');
  });

  test('input is empty when no folder name is stored', async () => {
    await initOptions();

    expect(document.querySelector('#input-folder-name').value).toBe('');
  });

  test('saves and shows success message when name is unique', async () => {
    await initOptions();

    document.querySelector('#input-folder-name').value = 'My Reading';
    document.querySelector('#btn-save-folder-name').click();
    await flushPromises();

    const stored = await browser.storage.local.get('pile-folder-name');
    expect(stored['pile-folder-name']).toBe('My Reading');

    const feedbackEl = document.querySelector('#folder-name-error');
    expect(feedbackEl.textContent).toBe('Folder renamed to "My Reading".');
    expect(feedbackEl.classList.contains('error')).toBe(false);
  });

  test('shows error and does not save when a folder with that name already exists', async () => {
    browser.seed({ title: 'Work', type: 'folder' });
    await initOptions();

    document.querySelector('#input-folder-name').value = 'Work';
    document.querySelector('#btn-save-folder-name').click();
    await flushPromises();

    const stored = await browser.storage.local.get('pile-folder-name');
    expect(stored['pile-folder-name']).toBeUndefined();

    const feedbackEl = document.querySelector('#folder-name-error');
    expect(feedbackEl.textContent).toBe('A folder named "Work" already exists.');
    expect(feedbackEl.classList.contains('error')).toBe(true);
  });

  test('does nothing when name is unchanged', async () => {
    await browser.storage.local.set({ 'pile-folder-name': 'My Pile' });
    await initOptions();

    const searchCallsBefore = browser.stats.bookmarks.search;
    document.querySelector('#input-folder-name').value = 'My Pile';
    document.querySelector('#btn-save-folder-name').click();
    await flushPromises();

    expect(browser.stats.bookmarks.search).toBe(searchCallsBefore);
    expect(document.querySelector('#folder-name-error').textContent).toBe('');
  });

  test('error is cleared when a valid name is saved after a conflict', async () => {
    browser.seed({ title: 'Work', type: 'folder' });
    await initOptions();

    document.querySelector('#input-folder-name').value = 'Work';
    document.querySelector('#btn-save-folder-name').click();
    await flushPromises();
    expect(document.querySelector('#folder-name-error').classList.contains('error')).toBe(true);

    document.querySelector('#input-folder-name').value = 'My Reading';
    document.querySelector('#btn-save-folder-name').click();
    await flushPromises();

    const feedbackEl = document.querySelector('#folder-name-error');
    expect(feedbackEl.classList.contains('error')).toBe(false);
    expect(feedbackEl.textContent).toBe('Folder renamed to "My Reading".');
  });

  test('empty input treats name as "Pile" and saves when current name differs', async () => {
    await browser.storage.local.set({ 'pile-folder-name': 'Old Name' });
    await initOptions();

    document.querySelector('#input-folder-name').value = '';
    document.querySelector('#btn-save-folder-name').click();
    await flushPromises();

    const stored = await browser.storage.local.get('pile-folder-name');
    expect(stored['pile-folder-name']).toBe('');

    const feedbackEl = document.querySelector('#folder-name-error');
    expect(feedbackEl.textContent).toBe('Folder renamed to "Pile".');
  });
});

describe('Options page - sessions', () => {
  test('defaults to enabled with a 2 hour gap when nothing is stored', async () => {
    await initOptions();

    expect(document.querySelector('#checkbox-session-enabled').checked).toBe(true);
    expect(document.querySelector('#input-session-gap').value).toBe('2');
    expect(document.querySelector('#input-session-gap').disabled).toBe(false);
  });

  test('reflects stored values and disables the gap input when sessions are off', async () => {
    await browser.storage.local.set({ 'pile-session-enabled': false, 'pile-session-gap-hours': 5 });
    await initOptions();

    expect(document.querySelector('#checkbox-session-enabled').checked).toBe(false);
    expect(document.querySelector('#input-session-gap').value).toBe('5');
    expect(document.querySelector('#input-session-gap').disabled).toBe(true);
  });

  test('toggling the checkbox saves the flag and disables the gap input', async () => {
    await initOptions();

    const checkbox = document.querySelector('#checkbox-session-enabled');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    await flushPromises();

    const stored = await browser.storage.local.get('pile-session-enabled');
    expect(stored['pile-session-enabled']).toBe(false);
    expect(document.querySelector('#input-session-gap').disabled).toBe(true);
  });

  test('changing the gap clamps out-of-range values and saves', async () => {
    await initOptions();

    const input = document.querySelector('#input-session-gap');
    input.value = '999';
    input.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(input.value).toBe('168');
    const stored = await browser.storage.local.get('pile-session-gap-hours');
    expect(stored['pile-session-gap-hours']).toBe(168);
  });
});
