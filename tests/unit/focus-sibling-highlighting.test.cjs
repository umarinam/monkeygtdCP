const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/render-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  // Create a minimal sandbox with required dependencies
  const sandbox = {
    console,
    document: {
      getElementById: (id) => ({
        textContent: '',
        className: '',
        innerHTML: ''
      })
    }
  };

  vm.createContext(sandbox);
  
  // We need to load the utils functions that render-controller depends on
  const cqrsPath = path.join(process.cwd(), 'js/core/cqrs.js');
  const cqrsSource = fs.readFileSync(cqrsPath, 'utf8');
  vm.runInContext(cqrsSource, sandbox, { filename: 'cqrs.js' });

  const utilsPath = path.join(process.cwd(), 'js/core/utils.js');
  const utilsSource = fs.readFileSync(utilsPath, 'utf8');
  vm.runInContext(utilsSource, sandbox, { filename: 'utils.js' });

  vm.runInContext(`${source}\n;globalThis.__render = { getTaskFocusCache, getTaskFocusClassName };`, sandbox, { filename: 'render-controller.js' });
  return sandbox.__render;
}

test('getTaskFocusCache collects sibling IDs of selected task', () => {
  const { getTaskFocusCache } = loadRenderController();

  const state = {
    selId: 'task-2',
    data: {
      tasks: {
        'task-1': { id: 'task-1', parent_id: null, tasks: ['task-2', 'task-3'] },
        'task-2': { id: 'task-2', parent_id: 'task-1', tasks: [] },
        'task-3': { id: 'task-3', parent_id: 'task-1', tasks: [] }
      }
    }
  };

  const cache = getTaskFocusCache(state);

  assert(cache, 'cache should be created');
  assert(cache.branchIds.has('task-2'), 'selected task should be in branchIds');
  assert(cache.branchIds.has('task-1'), 'parent should be in branchIds');
  assert(cache.siblingIds.has('task-3'), 'sibling task-3 should be in siblingIds');
  assert(!cache.siblingIds.has('task-1'), 'parent should not be in siblingIds');
  assert(!cache.siblingIds.has('task-2'), 'selected task should not be in siblingIds');
});

test('getTaskFocusClassName returns focus-sibling for siblings', () => {
  const { getTaskFocusCache, getTaskFocusClassName } = loadRenderController();

  const state = {
    selId: 'task-2',
    data: {
      settings: { focusMode: 'path' },
      tasks: {
        'task-1': { id: 'task-1', parent_id: null, tasks: ['task-2', 'task-3'] },
        'task-2': { id: 'task-2', parent_id: 'task-1', tasks: [] },
        'task-3': { id: 'task-3', parent_id: 'task-1', tasks: [] }
      }
    }
  };

  assert.equal(getTaskFocusClassName(state, 'task-2'), ' focus-active', 'selected task gets focus-active');
  assert.equal(getTaskFocusClassName(state, 'task-1'), ' focus-path', 'parent gets focus-path');
  assert.equal(getTaskFocusClassName(state, 'task-3'), ' focus-sibling', 'sibling gets focus-sibling');
});

test('getTaskFocusClassName returns focus-dim for non-related tasks', () => {
  const { getTaskFocusClassName } = loadRenderController();

  const state = {
    selId: 'task-2',
    data: {
      settings: { focusMode: 'path' },
      tasks: {
        'task-1': { id: 'task-1', parent_id: null, tasks: ['task-2', 'task-3', 'task-4'] },
        'task-2': { id: 'task-2', parent_id: 'task-1', tasks: ['task-5'] },
        'task-3': { id: 'task-3', parent_id: 'task-1', tasks: [] },
        'task-4': { id: 'task-4', parent_id: 'task-1', tasks: [] },
        'task-5': { id: 'task-5', parent_id: 'task-2', tasks: [] }
      }
    }
  };

  assert.equal(getTaskFocusClassName(state, 'task-2'), ' focus-active', 'selected task gets focus-active');
  assert.equal(getTaskFocusClassName(state, 'task-3'), ' focus-sibling', 'sibling task-3 gets focus-sibling');
  assert.equal(getTaskFocusClassName(state, 'task-4'), ' focus-sibling', 'sibling task-4 gets focus-sibling');
  assert.equal(getTaskFocusClassName(state, 'task-5'), ' focus-path', 'child gets focus-path');
  assert.equal(getTaskFocusClassName(state, 'task-1'), ' focus-path', 'parent gets focus-path');
});

test('focus siblings not returned when focusMode is off', () => {
  const { getTaskFocusClassName } = loadRenderController();

  const state = {
    selId: 'task-2',
    data: {
      settings: { focusMode: 'off' },
      tasks: {
        'task-1': { id: 'task-1', parent_id: null, tasks: ['task-2', 'task-3'] },
        'task-2': { id: 'task-2', parent_id: 'task-1', tasks: [] },
        'task-3': { id: 'task-3', parent_id: 'task-1', tasks: [] }
      }
    }
  };

  assert.equal(getTaskFocusClassName(state, 'task-2'), '', 'no class returned when focusMode is off');
  assert.equal(getTaskFocusClassName(state, 'task-3'), '', 'no class for sibling when focusMode is off');
});
