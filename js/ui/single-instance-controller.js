'use strict';

const SINGLE_INSTANCE_LOCK_NAME = 'mgtd3-single-instance';

function singleInstanceLocksAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.locks && typeof navigator.locks.request === 'function';
}

// Requests the lock without waiting in line (ifAvailable). If granted, the
// held promise never resolves, so the lock stays with this tab for its
// entire lifetime; the browser releases it automatically on crash, force
// close, or normal tab close - no manual release/heartbeat needed.
function acquireSingleInstanceLockUi() {
  return new Promise(resolve => {
    if (!singleInstanceLocksAvailable()) {
      resolve(true);
      return;
    }
    navigator.locks.request(SINGLE_INSTANCE_LOCK_NAME, { ifAvailable: true }, lock => {
      if (!lock) {
        resolve(false);
        return Promise.resolve();
      }
      resolve(true);
      return new Promise(() => {});
    }).catch(() => resolve(true));
  });
}

// Best-effort claim used after a manual force-unlock: try to also become the
// lock holder (protects against a third tab), but never block this tab on it.
function claimSingleInstanceLockBestEffort() {
  if (!singleInstanceLocksAvailable()) return;
  navigator.locks.request(SINGLE_INSTANCE_LOCK_NAME, { ifAvailable: true }, lock => {
    if (!lock) return Promise.resolve();
    return new Promise(() => {});
  }).catch(() => {});
}

function showInstanceBlockedUi() {
  document.getElementById('instance-blocked')?.classList.remove('hidden');
}

function hideInstanceBlockedUi() {
  document.getElementById('instance-blocked')?.classList.add('hidden');
}

function initSingleInstanceUi(app) {
  acquireSingleInstanceLockUi().then(granted => {
    if (granted) app.boot();
    else showInstanceBlockedUi();
  });
}

function retrySingleInstanceUi(app) {
  acquireSingleInstanceLockUi().then(granted => {
    if (!granted) return;
    hideInstanceBlockedUi();
    app.boot();
  });
}

function forceUnlockAndContinueUi(app) {
  hideInstanceBlockedUi();
  claimSingleInstanceLockBestEffort();
  app.boot();
}
