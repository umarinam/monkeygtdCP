const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadStyles() {
  return fs.readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
}

test('styles define task font color by priority levels', () => {
  const css = loadStyles();

  for (let i = 1; i <= 9; i++) {
    const selector = `.ti.priority-${i} .tc{color:var(--p${i})}`;
    assert.equal(css.includes(selector), true, `Missing selector: ${selector}`);
  }
});

test('priority task links inherit priority color', () => {
  const css = loadStyles();
  assert.equal(css.includes('.ti[class*="priority-"] .tc a{color:inherit}'), true);
});
