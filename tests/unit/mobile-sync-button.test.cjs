const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('app shell includes mobile sync button wired to provider-aware sync action', () => {
  const html = read('app.html');
  assert.equal(/id="mobile-sync-btn"/.test(html), true);
  assert.equal(/onclick="App\.syncNow\(\)"/.test(html), true);
});

test('styles do not hide sync button behind mobile-only rules', () => {
  const css = read('styles.css');
  assert.equal(/\.m-sync-btn\{display:none\}/.test(css), false);
});
