const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('core project files are present', () => {
  assert.equal(fs.existsSync('app.html'), true);
  assert.equal(fs.existsSync('styles.css'), true);
  assert.equal(fs.existsSync('js/app.js'), true);
});

test('github workflow and PR template are present', () => {
  assert.equal(fs.existsSync('.github/workflows/tests.yml'), true);
  assert.equal(fs.existsSync('.github/pull_request_template.md'), true);
});
