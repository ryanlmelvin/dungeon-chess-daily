// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
export function initPersistentStorage({ button, onStatus, storage = globalThis.navigator?.storage }) {
  let busy = false;
  const supported = typeof storage?.persist === 'function' && typeof storage?.persisted === 'function';

  function render(enabled) {
    button.disabled = enabled || !supported;
    button.textContent = !supported ? 'Persistent storage unavailable' : enabled ? 'Persistent storage enabled' : 'Enable persistent storage';
  }

  async function refresh() {
    if (busy) return;
    if (!supported) { render(false); return; }
    busy = true;
    button.disabled = true;
    try { render(await storage.persisted()); }
    catch { render(false); }
    finally { busy = false; }
  }

  button.addEventListener('click', async () => {
    if (busy || button.disabled || !supported) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Requesting storage…';
    try {
      // Request directly from the click; never prompt during startup or autosave.
      const enabled = await storage.persist();
      render(enabled);
      onStatus(enabled
        ? 'Persistent storage enabled. Clearing browser data can still erase progress, so keep a backup.'
        : 'Your browser did not grant persistent storage. Download a backup to keep a separate copy.');
    } catch {
      render(false);
      onStatus('Persistent storage could not be enabled. Try again or download a backup.');
    } finally { busy = false; }
  });

  render(false);
  return { refresh };
}
