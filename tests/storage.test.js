// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { initPersistentStorage } from '../src/storage.js';

function setup(storage) {
  let click;
  const button = {
    disabled: false,
    textContent: '',
    addEventListener(type, listener) {
      assert.equal(type, 'click');
      click = listener;
    },
  };
  const messages = [];
  const controller = initPersistentStorage({ button, storage, onStatus: (message) => messages.push(message) });
  return { button, messages, click: () => click(), ...controller };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('initialization and menu refresh only inspect storage, including existing grants and later revocation', async () => {
  let enabled = false;
  let checks = 0;
  let requests = 0;
  const ui = setup({
    persisted: async () => { checks++; return enabled; },
    persist: async () => { requests++; return true; },
  });
  assert.equal(checks, 0);
  assert.equal(requests, 0);
  await ui.refresh();
  assert.equal(ui.button.disabled, false);
  enabled = true;
  await ui.refresh();
  assert.equal(ui.button.disabled, true);
  assert.match(ui.button.textContent, /enabled/i);
  await ui.click();
  assert.equal(requests, 0);
  enabled = false;
  await ui.refresh();
  assert.equal(ui.button.disabled, false);
  assert.equal(checks, 3);
  assert.equal(requests, 0);
  assert.deepEqual(ui.messages, []);
});

test('a click requests persistence synchronously and pending requests cannot be duplicated or overwritten by refresh', async () => {
  const request = deferred();
  let requests = 0;
  let checks = 0;
  const ui = setup({
    persisted: async () => { checks++; return false; },
    persist: () => { requests++; return request.promise; },
  });
  const clicked = ui.click();
  // This assertion runs before a microtask, preserving the click's activation.
  assert.equal(requests, 1);
  assert.equal(checks, 0);
  assert.equal(ui.button.disabled, true);
  await ui.click();
  await ui.refresh();
  assert.equal(requests, 1);
  assert.equal(checks, 0);
  assert.deepEqual(ui.messages, []);
  request.resolve(true);
  await clicked;
  assert.equal(ui.button.disabled, true);
  assert.match(ui.button.textContent, /enabled/i);
  assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0], /enabled.*clearing browser data.*backup/i);
  // The next menu opening reads the browser again instead of caching the grant.
  await ui.refresh();
  assert.equal(checks, 1);
  assert.equal(ui.button.disabled, false);
});

test('a declined request offers a backup and permits a later retry', async () => {
  let requests = 0;
  const ui = setup({
    persisted: async () => false,
    persist: async () => ++requests > 1,
  });
  await ui.click();
  assert.equal(ui.button.disabled, false);
  assert.match(ui.messages[0], /did not grant.*backup/i);
  await ui.click();
  assert.equal(requests, 2);
  assert.equal(ui.button.disabled, true);
  assert.match(ui.messages[1], /enabled/i);
});

test('request errors produce feedback and leave the control usable', async (t) => {
  for (const asynchronous of [false, true]) {
    await t.test(asynchronous ? 'rejected promise' : 'synchronous throw', async () => {
      let fail = true;
      const ui = setup({
        persisted: async () => false,
        persist() {
          if (!fail) return Promise.resolve(true);
          const error = new Error('Storage request failed');
          if (asynchronous) return Promise.reject(error);
          throw error;
        },
      });
      await ui.click();
      assert.equal(ui.button.disabled, false);
      assert.match(ui.messages[0], /could not be enabled.*backup/i);
      fail = false;
      await ui.click();
      assert.equal(ui.button.disabled, true);
    });
  }
});

test('missing storage APIs disable the control without making requests', async () => {
  let calls = 0;
  for (const storage of [null, {}, { persist: () => { calls++; } }, { persisted: () => { calls++; } }]) {
    const ui = setup(storage);
    await ui.refresh();
    await ui.click();
    assert.equal(ui.button.disabled, true);
    assert.match(ui.button.textContent, /unavailable/i);
    assert.deepEqual(ui.messages, []);
  }
  assert.equal(calls, 0);
});

test('a failed status check does not request permission or prevent a user request', async () => {
  let requests = 0;
  const ui = setup({
    persisted: async () => { throw new Error('Status unavailable'); },
    persist: async () => { requests++; return true; },
  });
  await ui.refresh();
  assert.equal(requests, 0);
  assert.equal(ui.button.disabled, false);
  assert.deepEqual(ui.messages, []);
  await ui.click();
  assert.equal(requests, 1);
  assert.equal(ui.button.disabled, true);
});
