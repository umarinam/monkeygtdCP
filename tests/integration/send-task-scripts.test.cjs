// Contract tests for the CLI capture scripts (scripts/send-task.py, send-task.ps1, send-task.cmd):
// every line they queue must be accepted by the app's own inbox importers in
// js/infra/gist-sync.js and js/infra/repo-sync.js, and the Gist/Repo writes must
// append to the existing queue file. Runners whose interpreter is missing are skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = process.cwd();

function findCommand(candidates, probeArgs, expected) {
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, probeArgs, { encoding: 'utf8' });
    if (probe.status === 0 && String(probe.stdout || '').trim() === expected) return cmd;
  }
  return null;
}

const PYTHON = findCommand(
  process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'],
  ['-c', 'import sys; print(sys.version_info[0])'],
  '3'
);
const POWERSHELL = findCommand(
  process.platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh'],
  ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output ok'],
  'ok'
);

function scriptEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('MGTD_')) delete env[key];
  }
  return { ...env, ...extra };
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: scriptEnv(env) });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function pyArgs(o) {
  const args = [];
  if (o.inbox) args.push('--inbox');
  if (o.listId) args.push('--list-id', o.listId);
  if (o.due) args.push('--due', o.due);
  if (o.asap) args.push('--asap');
  if (o.provider) args.push('--provider', o.provider);
  if (o.dryRun) args.push('--dry-run');
  if (o.parent) args.push(o.parent);
  return [...args, ...o.words];
}

function psArgs(o) {
  const args = [];
  if (o.inbox) args.push('-Inbox');
  if (o.listId) args.push('-ListId', o.listId);
  if (o.due) args.push('-Due', o.due);
  if (o.asap) args.push('-Asap');
  if (o.provider) args.push('-Provider', o.provider);
  if (o.dryRun) args.push('-DryRun');
  if (o.parent) args.push(o.parent);
  return [...args, ...o.words];
}

function cmdArgs(o) {
  const args = [];
  if (o.inbox) args.push('--inbox');
  if (o.listId) args.push('--list-id', o.listId);
  if (o.due) args.push('--due', o.due);
  if (o.asap) args.push('--asap');
  if (o.provider) args.push('--provider', o.provider);
  if (o.dryRun) args.push('--dry-run');
  if (o.parent) args.push(o.parent);
  return [...args, ...o.words];
}

const RUNNERS = [
  {
    name: 'send-task.py',
    skip: PYTHON ? false : 'python 3 not found',
    network: true,
    exec: (o, env) => run(PYTHON, [path.join('scripts', 'send-task.py'), ...pyArgs(o)], env)
  },
  {
    name: 'send-task.ps1',
    skip: POWERSHELL ? false : 'PowerShell not found',
    network: true,
    exec: (o, env) => run(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join('scripts', 'send-task.ps1'), ...psArgs(o)],
      env
    )
  },
  {
    // Delegates to send-task.ps1, so only its argument handling is exercised here.
    name: 'send-task.cmd',
    skip: process.platform !== 'win32' ? 'Windows only' : (POWERSHELL === 'powershell' ? false : 'Windows PowerShell not found'),
    network: false,
    exec: (o, env) => run('cmd.exe', ['/d', '/c', path.join('scripts', 'send-task.cmd'), ...cmdArgs(o)], env)
  }
];

function loadInboxImporters() {
  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Promise,
    Buffer,
    setInterval,
    clearInterval,
    fetch: async () => { throw new Error('network disabled in tests'); },
    document: { getElementById: () => null },
    localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/infra/gist-sync.js'), 'utf8'), sandbox, { filename: 'gist-sync.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/infra/repo-sync.js'), 'utf8'), sandbox, { filename: 'repo-sync.js' });
  vm.runInContext('globalThis.__inboxExports = { gistApplyInboxRequest, repoApplyInboxRequest };', sandbox);
  return {
    gist: sandbox.__inboxExports.gistApplyInboxRequest,
    repo: sandbox.__inboxExports.repoApplyInboxRequest
  };
}

const IMPORTERS = loadInboxImporters();

function makeState() {
  return {
    data: {
      tasks: {
        abc123: { id: 'abc123', content: 'Groceries', checklist_id: 'l1', parent_id: '', tasks: [], deleted: false }
      },
      lists: {
        l1: { id: 'l1', name: 'Inbox', root_tasks: ['abc123'] },
        l2: { id: 'l2', name: 'Travel', root_tasks: [] }
      },
      currentListId: 'l2',
      settings: {}
    }
  };
}

function parseQueuedLine(result) {
  assert.equal(result.status, 0, `script failed:\n${result.stdout}\n${result.stderr}`);
  const lines = result.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  assert.equal(lines.length, 1, `expected exactly one queued line on stdout, got:\n${result.stdout}`);
  return JSON.parse(lines[0]);
}

function assertCommonFields(req) {
  assert.equal(typeof req.id, 'string');
  assert.ok(req.id.length > 0, 'request id must be non-empty so the app can de-duplicate it');
  assert.ok(Number.isFinite(Date.parse(req.at)), `"at" must be an ISO timestamp, got ${req.at}`);
  assert.equal(typeof req.source, 'string');
}

const SCENARIOS = [
  {
    name: 'adds a child under the parent task',
    opts: { parent: 'abc123', words: ['Buy', 'milk', '(2L)'] },
    expect: { action: 'addChild', parentTaskId: 'abc123', content: 'Buy milk (2L)' },
    check(state, task) {
      assert.deepEqual(Array.from(state.data.tasks.abc123.tasks), [task.id]);
      assert.equal(task.parent_id, 'abc123');
      assert.equal(task.checklist_id, 'l1');
    }
  },
  {
    name: 'accepts a permalink URL as the parent id',
    opts: { parent: 'https://example.com/app#task-abc123', words: ['Fix', 'it'] },
    expect: { action: 'addChild', parentTaskId: 'abc123', content: 'Fix it' },
    check(state, task) {
      assert.deepEqual(Array.from(state.data.tasks.abc123.tasks), [task.id]);
    }
  },
  {
    name: 'inbox mode adds a top-level task to the list named Inbox',
    opts: { inbox: true, words: ['Call', 'mom'] },
    expect: { action: 'addInbox', content: 'Call mom' },
    absent: ['parentTaskId', 'listId'],
    check(state, task) {
      assert.deepEqual(Array.from(state.data.lists.l1.root_tasks), ['abc123', task.id]);
      assert.equal(task.parent_id, '');
    }
  },
  {
    name: 'list mode adds a top-level task to that list',
    opts: { listId: 'l2', words: ['Plan', 'trip'] },
    expect: { action: 'addInbox', listId: 'l2', content: 'Plan trip' },
    absent: ['parentTaskId'],
    check(state, task) {
      assert.deepEqual(Array.from(state.data.lists.l2.root_tasks), [task.id]);
      assert.equal(task.checklist_id, 'l2');
    }
  },
  {
    name: 'due date is applied to the imported task',
    opts: { parent: 'abc123', words: ['Pay', 'rent'], due: '2026-10-05' },
    expect: { action: 'addChild', due: '2026-10-05' },
    absent: ['due_asap'],
    check(state, task) {
      assert.equal(task.due, '2026-10-05');
      assert.equal(task.due_asap, false);
    }
  },
  {
    name: 'asap flag is applied to the imported task',
    opts: { inbox: true, words: ['Renew', 'passport'], asap: true },
    expect: { action: 'addInbox', due_asap: true },
    absent: ['due'],
    check(state, task) {
      assert.equal(task.due_asap, true);
      assert.equal(task.due, '');
    }
  }
];

async function withGitHubStub(routes, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(entry);
      const handler = routes[`${req.method} ${req.url}`];
      const { status, json } = handler ? handler(entry) : { status: 404, json: { message: 'Not Found' } };
      res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(json || {}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function base64Lines(text) {
  // GitHub wraps base64 content at 60 characters.
  return Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
}

for (const runner of RUNNERS) {
  test(`${runner.name} queues lines the app's inbox importers accept`, { skip: runner.skip }, async (t) => {
    for (const scenario of SCENARIOS) {
      await t.test(scenario.name, async () => {
        const req = parseQueuedLine(await runner.exec({ ...scenario.opts, dryRun: true }));
        assertCommonFields(req);
        for (const [key, value] of Object.entries(scenario.expect)) {
          assert.deepEqual(req[key], value, `field ${key}`);
        }
        for (const key of scenario.absent || []) {
          assert.equal(key in req, false, `field ${key} should be absent`);
        }

        for (const [provider, apply] of Object.entries(IMPORTERS)) {
          const state = makeState();
          const result = apply(state, req);
          assert.equal(result.applied, true, `${provider} importer rejected the line: ${result.reason}`);
          scenario.check(state, state.data.tasks[result.taskId]);
        }
      });
    }
  });

  test(`${runner.name} rejects bad input without queueing anything`, { skip: runner.skip }, async (t) => {
    await t.test('invalid due date', async () => {
      const result = await runner.exec({ parent: 'abc123', words: ['Pay'], due: '2026-02-30', dryRun: true });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout.includes('"action"'), false);
    });

    await t.test('missing task text', async () => {
      const result = await runner.exec({ parent: 'abc123', words: [], dryRun: true });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout.includes('"action"'), false);
    });
  });

  test(`${runner.name} appends to the Gist and Repo inbox files`, { skip: runner.skip || (!runner.network && 'delegates to send-task.ps1') }, async (t) => {
    const oldLine = '{"id":"old","action":"addInbox","content":"Earlier task"}';

    await t.test('gist: PATCHes the inbox file with the new line appended', async () => {
      const routes = {
        'GET /gists/g1': () => ({
          json: { files: { 'monkeygtd-inbox.ndjson': { filename: 'monkeygtd-inbox.ndjson', content: `${oldLine}\n`, truncated: false } } }
        }),
        'PATCH /gists/g1': () => ({ json: {} })
      };
      await withGitHubStub(routes, async (apiUrl, requests) => {
        const result = await runner.exec(
          { parent: 'abc123', words: ['Buy', 'café', 'beans'] },
          { MGTD_GITHUB_API_URL: apiUrl, MGTD_GIST_ID: 'g1', MGTD_GIST_TOKEN: 'gist-token' }
        );
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

        const patch = requests.find((r) => r.method === 'PATCH');
        assert.ok(patch, 'expected a PATCH to the gist');
        assert.equal(patch.headers.authorization, 'token gist-token');
        const lines = patch.body.files['monkeygtd-inbox.ndjson'].content.split('\n');
        assert.equal(lines.length, 2);
        assert.equal(lines[0], oldLine);
        const req = JSON.parse(lines[1]);
        assert.equal(req.action, 'addChild');
        assert.equal(req.parentTaskId, 'abc123');
        assert.equal(req.content, 'Buy café beans');
      });
    });

    await t.test('repo: PUTs the inbox file next to the backup file, appending and passing the sha', async () => {
      const contentsPath = '/repos/octo/backups/contents/data/monkeygtd-inbox.ndjson';
      const routes = {
        [`GET ${contentsPath}?ref=dev`]: () => ({
          json: { type: 'file', sha: 'sha-1', size: oldLine.length + 1, encoding: 'base64', content: base64Lines(`${oldLine}\n`) }
        }),
        [`PUT ${contentsPath}`]: () => ({ status: 200, json: { content: { sha: 'sha-2' } } })
      };
      await withGitHubStub(routes, async (apiUrl, requests) => {
        const result = await runner.exec(
          { provider: 'repo', listId: 'l2', words: ['Plan', 'trip'], due: '2026-10-05' },
          {
            MGTD_GITHUB_API_URL: apiUrl,
            MGTD_REPO_TOKEN: 'repo-token',
            MGTD_REPO_OWNER: 'octo',
            MGTD_REPO_NAME: 'backups',
            MGTD_REPO_BRANCH: 'dev',
            MGTD_REPO_PATH: 'data/monkeygtd-backup.json'
          }
        );
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

        const put = requests.find((r) => r.method === 'PUT');
        assert.ok(put, 'expected a PUT to the repo inbox file');
        assert.equal(put.headers.authorization, 'token repo-token');
        assert.equal(put.body.branch, 'dev');
        assert.equal(put.body.sha, 'sha-1');
        const lines = Buffer.from(put.body.content, 'base64').toString('utf8').split('\n');
        assert.equal(lines.length, 2);
        assert.equal(lines[0], oldLine);
        const req = JSON.parse(lines[1]);
        assert.equal(req.action, 'addInbox');
        assert.equal(req.listId, 'l2');
        assert.equal(req.due, '2026-10-05');
      });
    });

    await t.test('repo: creates the inbox file when it does not exist yet', async () => {
      const contentsPath = '/repos/octo/backups/contents/monkeygtd-inbox.ndjson';
      const routes = {
        [`PUT ${contentsPath}`]: () => ({ status: 201, json: { content: { sha: 'sha-new' } } })
      };
      await withGitHubStub(routes, async (apiUrl, requests) => {
        const result = await runner.exec(
          { provider: 'repo', inbox: true, words: ['First', 'task'] },
          { MGTD_GITHUB_API_URL: apiUrl, MGTD_REPO_TOKEN: 'repo-token', MGTD_REPO_OWNER: 'octo', MGTD_REPO_NAME: 'backups' }
        );
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

        assert.ok(requests.some((r) => r.method === 'GET' && r.url === `${contentsPath}?ref=main`));
        const put = requests.find((r) => r.method === 'PUT');
        assert.ok(put, 'expected a PUT to create the repo inbox file');
        assert.equal('sha' in put.body, false);
        const text = Buffer.from(put.body.content, 'base64').toString('utf8');
        assert.equal(text.includes('\n'), false);
        assert.equal(JSON.parse(text).action, 'addInbox');
      });
    });
  });
}
