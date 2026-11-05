// Copyright (C) 2026 Ryan L. Melvin. GPL-3.0-only.

/** Install help is always reachable in a browser, including Safari. */
export function initPWA({ installButton, updateButton, onBeforeUpdate = async () => true, onStatus = () => {} }) {
  let installPrompt;
  let registration;
  let updateInFlight;
  let lastCheck = 0;
  let updating = false;
  let reloadRequested = false;
  let newerController = false;
  let hadController = !!navigator.serviceWorker?.controller;
  let activationTimeout;
  let destroyed = false;
  const disposers = [];
  const standalone = window.matchMedia('(display-mode: standalone)');
  const dialog = document.createElement('dialog');
  dialog.className = 'pwa-dialog';
  dialog.setAttribute('aria-labelledby', 'install-title');
  dialog.innerHTML = `<h2 id="install-title">Install Dungeon Chess Daily</h2>
    <details open><summary>iPhone or iPad</summary><p>Open this game in Safari. Tap Share (the square with an up arrow; you may need to open the … menu first). Choose Add to Home Screen; if missing, find it under Edit Actions. Turn on Open as Web App if shown, then tap Add.</p></details>
    <details open><summary>Android</summary><p>Open this game in Chrome. Tap the ⋮ menu, then Add to home screen or Install app. Choose Install if offered and follow the prompts.</p></details>
    <details><summary>Computer</summary><p>In Chrome or Edge, look for Install in the address bar or browser menu. On a Mac in Safari, choose File → Add to Dock.</p></details>
    <div class="dialog-actions"><button type="button" data-update hidden>Update available</button><button type="button" data-close>Close</button></div>`;
  document.body.append(dialog);
  const dialogUpdate = dialog.querySelector('[data-update]');
  const updateButtons = [updateButton, dialogUpdate];
  const updateStatus = [];
  const extraPanels = [];
  // Native dialogs sit above the page. Keep both the action and its feedback
  // inside their top layer, rather than behind the dialog's backdrop.
  for (const target of document.querySelectorAll('dialog')) {
    const panel = document.createElement('div');
    panel.className = 'pwa-update-panel';
    const status = document.createElement('p');
    status.hidden = true;
    status.setAttribute('role', 'status');
    panel.append(status);
    if (target !== dialog) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'update-button';
      button.hidden = true;
      button.textContent = 'Update available';
      panel.append(button);
      updateButtons.push(button);
    }
    target.append(panel);
    extraPanels.push(panel);
    updateStatus.push({ target, status });
  }
  const reportStatus = (message) => {
    onStatus(message);
    for (const { target, status } of updateStatus) {
      if (!target.open) continue;
      status.textContent = message;
      status.hidden = !message;
    }
  };
  const listen = (target, event, callback, options) => {
    target.addEventListener(event, callback, options);
    disposers.push(() => target.removeEventListener(event, callback, options));
  };
  const updateInstallVisibility = () => {
    installButton.hidden = standalone.matches || navigator.standalone === true;
    if (installButton.hidden && dialog.open) dialog.close();
  };
  const reflectUpdate = () => {
    const available = !!registration?.waiting || newerController;
    for (const button of updateButtons) {
      button.hidden = !available;
      button.disabled = updating;
      button.textContent = updating ? 'Updating…' : 'Update available';
    }
  };
  const failUpdate = (message) => {
    clearTimeout(activationTimeout);
    updating = false;
    reloadRequested = false;
    reflectUpdate();
    reportStatus(message);
  };
  const acceptUpdate = async () => {
    if (updating || (!registration?.waiting && !newerController)) return;
    updating = true;
    for (const { status } of updateStatus) { status.textContent = ''; status.hidden = true; }
    reflectUpdate();
    try {
      if (await onBeforeUpdate() !== true) {
        failUpdate('Your progress could not be saved. Keep this game open and try updating again.');
        return;
      }
      if (newerController && !registration?.waiting) {
        location.reload();
        return;
      }
      if (!registration?.waiting) {
        failUpdate('The update is no longer ready. Please try again.');
        return;
      }
      reloadRequested = true;
      activationTimeout = setTimeout(() => {
        failUpdate('The update did not finish. Your progress is saved; try again or use Update recovery in About.');
      }, 12000);
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      failUpdate('The update could not start. Keep playing, or try again.');
    }
  };
  listen(dialog.querySelector('[data-close]'), 'click', () => dialog.close());
  listen(dialog, 'close', () => { if (!installButton.hidden) installButton.focus(); });
  listen(installButton, 'click', async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        if (!dialog.open) dialog.showModal();
      }
    } else if (!dialog.open) dialog.showModal();
  });
  listen(window, 'beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallVisibility();
  });
  listen(window, 'appinstalled', () => {
    installPrompt = null;
    installButton.hidden = true;
    if (dialog.open) dialog.close();
  });
  listen(standalone, 'change', updateInstallVisibility);
  for (const button of updateButtons) listen(button, 'click', acceptUpdate);
  updateInstallVisibility();
  updateButton.hidden = true;

  const checkForUpdates = async (force = false) => {
    if (!registration || !navigator.onLine || destroyed) return;
    if (updateInFlight) return updateInFlight;
    if (!force && Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    updateInFlight = registration.update().catch(() => {
      if (force) reportStatus('Could not check for an update. Try again when connected.');
    }).finally(() => { updateInFlight = null; reflectUpdate(); });
    return updateInFlight;
  };

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    listen(navigator.serviceWorker, 'controllerchange', () => {
      if (reloadRequested) {
        reloadRequested = false;
        clearTimeout(activationTimeout);
        location.reload();
      } else if (hadController) {
        // Another window accepted the update. This window keeps its own reload consent.
        newerController = true;
      }
      hadController = true;
      reflectUpdate();
    });
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
      if (destroyed) return;
      registration = reg;
      const watchInstalling = () => {
        const worker = registration.installing;
        if (!worker) return;
        listen(worker, 'statechange', () => {
          if (worker.state === 'installed') reflectUpdate();
        });
      };
      listen(registration, 'updatefound', watchInstalling);
      watchInstalling();
      reflectUpdate();
      checkForUpdates();
    }).catch(() => {
      // A failed first download does not interrupt a currently playable game.
      if (navigator.onLine) reportStatus('Offline installation could not finish. Reopen the game to retry.');
    });
    listen(document, 'visibilitychange', () => { if (!document.hidden) checkForUpdates(); });
    listen(window, 'online', () => checkForUpdates(true));
  }
  const interval = setInterval(() => { if (!document.hidden) checkForUpdates(); }, 60000);
  return {
    checkForUpdates: () => checkForUpdates(true),
    destroy() {
      destroyed = true;
      clearInterval(interval);
      clearTimeout(activationTimeout);
      disposers.forEach((dispose) => dispose());
      extraPanels.forEach((panel) => panel.remove());
      dialog.remove();
    },
  };
}

/** Reports the controlling release, rather than a newer file on the server. */
export async function getReleaseVersion() {
  if (!import.meta.env.PROD) return 'development';
  if (navigator.serviceWorker?.controller) {
    try {
      return await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('No worker response')); }, 1200);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          channel.port1.close();
          resolve(event.data.version);
        };
        navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
      });
    } catch { /* The initial load can use the published release file. */ }
  }
  try {
    const response = await fetch('./release.json');
    if (!response.ok) return 'unknown';
    return (await response.json()).version;
  } catch { return 'unknown'; }
}
