const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeFakeLocks({ granted, throws }) {
  const calls = [];
  return {
    calls,
    request: (name, opts, callback) => {
      calls.push({ name, opts });
      if (throws) return Promise.reject(new Error('locks unavailable'));
      const result = granted ? callback({ name, mode: 'exclusive' }) : callback(null);
      return result instanceof Promise ? result : Promise.resolve(result);
    }
  };
}

function createElement() {
  return { classList: { add: () => {}, remove: () => {} } };
}

function loadSingleInstanceController(navigatorOverride) {
  const sourcePath = path.join(process.cwd(), 'js/ui/single-instance-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const el = createElement();
  const sandbox = {
    console,
    navigator: navigatorOverride,
    document: { getElementById: () => el }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__siExports = { acquireSingleInstanceLockUi, initSingleInstanceUi, retrySingleInstanceUi, forceUnlockAndContinueUi };`,
    sandbox,
    { filename: 'single-instance-controller.js' }
  );

  return { ...sandbox.__siExports, el };
}

test('acquireSingleInstanceLockUi resolves true when the Locks API is unavailable (fail open)', async () => {
  const { acquireSingleInstanceLockUi } = loadSingleInstanceController(undefined);
  assert.equal(await acquireSingleInstanceLockUi(), true);
});

test('acquireSingleInstanceLockUi resolves true when the lock is granted', async () => {
  const locks = makeFakeLocks({ granted: true });
  const { acquireSingleInstanceLockUi } = loadSingleInstanceController({ locks });
  assert.equal(await acquireSingleInstanceLockUi(), true);
  assert.equal(locks.calls[0].opts.ifAvailable, true);
});

test('acquireSingleInstanceLockUi resolves false when another tab already holds the lock', async () => {
  const locks = makeFakeLocks({ granted: false });
  const { acquireSingleInstanceLockUi } = loadSingleInstanceController({ locks });
  assert.equal(await acquireSingleInstanceLockUi(), false);
});

test('acquireSingleInstanceLockUi fails open (resolves true) if the Locks API throws', async () => {
  const locks = makeFakeLocks({ throws: true });
  const { acquireSingleInstanceLockUi } = loadSingleInstanceController({ locks });
  assert.equal(await acquireSingleInstanceLockUi(), true);
});

test('initSingleInstanceUi boots the app when the lock is granted', async () => {
  const locks = makeFakeLocks({ granted: true });
  const { initSingleInstanceUi } = loadSingleInstanceController({ locks });
  const calls = { boot: 0 };
  const app = { boot: () => { calls.boot += 1; } };

  initSingleInstanceUi(app);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(calls.boot, 1);
});

test('initSingleInstanceUi does not boot when another tab holds the lock', async () => {
  const locks = makeFakeLocks({ granted: false });
  const { initSingleInstanceUi, el } = loadSingleInstanceController({ locks });
  const calls = { boot: 0, removedHidden: 0 };
  const app = { boot: () => { calls.boot += 1; } };
  el.classList.remove = (cls) => { if (cls === 'hidden') calls.removedHidden += 1; };

  initSingleInstanceUi(app);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(calls.boot, 0);
  assert.equal(calls.removedHidden, 1);
});

test('retrySingleInstanceUi boots and hides the blocked screen once the lock becomes available', async () => {
  const locks = makeFakeLocks({ granted: true });
  const { retrySingleInstanceUi, el } = loadSingleInstanceController({ locks });
  const calls = { boot: 0, addedHidden: 0 };
  const app = { boot: () => { calls.boot += 1; } };
  el.classList.add = (cls) => { if (cls === 'hidden') calls.addedHidden += 1; };

  retrySingleInstanceUi(app);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(calls.boot, 1);
  assert.equal(calls.addedHidden, 1);
});

test('retrySingleInstanceUi does nothing while the other tab still holds the lock', async () => {
  const locks = makeFakeLocks({ granted: false });
  const { retrySingleInstanceUi } = loadSingleInstanceController({ locks });
  const calls = { boot: 0 };
  const app = { boot: () => { calls.boot += 1; } };

  retrySingleInstanceUi(app);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(calls.boot, 0);
});

test('forceUnlockAndContinueUi always hides the blocked screen and boots, even if the lock is still held elsewhere', () => {
  const locks = makeFakeLocks({ granted: false });
  const { forceUnlockAndContinueUi, el } = loadSingleInstanceController({ locks });
  const calls = { boot: 0, addedHidden: 0 };
  const app = { boot: () => { calls.boot += 1; } };
  el.classList.add = (cls) => { if (cls === 'hidden') calls.addedHidden += 1; };

  forceUnlockAndContinueUi(app);

  assert.equal(calls.boot, 1);
  assert.equal(calls.addedHidden, 1);
  // Best-effort re-claim attempt should still have been made.
  assert.equal(locks.calls.length, 1);
});
