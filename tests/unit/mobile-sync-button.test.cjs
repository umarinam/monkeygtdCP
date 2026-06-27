const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('app shell includes mobile sync button wired to gist sync action', () => {
  const html = read('app.html');
  assert.equal(/id="mobile-sync-btn"/.test(html), true);
  assert.equal(/onclick="App\.syncGistNow\(\)"/.test(html), true);
});

test('styles include mobile breakpoint rule to show sync button', () => {
  const css = read('styles.css');
  assert.equal(/\.m-sync-btn\{display:none\}/.test(css), true);
  assert.equal(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*\.m-sync-btn\{display:inline-flex\}/.test(css), true);
});
