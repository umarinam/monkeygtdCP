const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

test('command palette includes clear-assignees and key two-key shortcut actions', () => {
  const src = read('js/ui/command-palette-commands.js');

  const required = [
    "{ l: 'Clear assignees', s: 'ca'",
    "{ l: 'Hide/show future due', s: 'hf'",
    "{ l: 'Toggle details', s: 'sd'",
    "{ l: 'Show branch progress', s: 'pc'",
    "{ l: 'Open lists picker', s: 'll'",
    "{ l: 'Open first URL in task', s: 'gg'",
    "{ l: 'Expand/collapse all', s: 'ec'",
    "{ l: 'Toggle multi-select for task', s: 'st'",
    "{ l: 'Copy task permalink', s: 'tc / lc'"
  ];

  for (const snippet of required) {
    assert.equal(src.includes(snippet), true, `Missing command palette entry: ${snippet}`);
  }
});

test('shortcuts help includes discoverability entries for advanced two-key actions', () => {
  const src = read('js/ui/utilities-controller.js');

  const required = [
    "['ca', 'Clear assignees']",
    "['hf', 'Hide/show future due']",
    "['sd', 'Toggle details']",
    "['pc', 'Show branch progress']",
    "['ll', 'Open lists picker']",
    "['gg', 'Open first URL in task']",
    "['ec', 'Expand/collapse all']",
    "['st', 'Toggle multi-select for task']",
    "['tc / lc', 'Copy task permalink']",
    "['tj', 'Edit task JSON']",
    "['th', 'View task history']"
  ];

  for (const snippet of required) {
    assert.equal(src.includes(snippet), true, `Missing shortcuts help entry: ${snippet}`);
  }
});
