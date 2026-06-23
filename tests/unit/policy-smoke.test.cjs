const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('policy script exists', () => {
  assert.equal(fs.existsSync('scripts/check-tests-required.cjs'), true);
});

test('copilot instructions exist', () => {
  assert.equal(fs.existsSync('.github/copilot-instructions.md'), true);
});
