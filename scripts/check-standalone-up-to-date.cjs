#!/usr/bin/env node

const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

// inline-html.ps1 stamps the bundle with the commit it was built from
// (window.__MGTD_STANDALONE_DEPLOY={deployedAt:'...',commit:'...'}). A commit
// can never contain its own hash, so a committed bundle always carries its
// parent's stamp and a byte-for-byte comparison could never pass in CI. The
// stamp's values are blanked before comparing, so only real HTML/CSS/JS drift
// fails the check. Pages regenerates the bundle at deploy time, so the
// published stamp is correct regardless.
const DEPLOY_STAMP_PATTERN = /window\.__MGTD_STANDALONE_DEPLOY=\{[^}]*\};/g;
const DEPLOY_STAMP_PLACEHOLDER = 'window.__MGTD_STANDALONE_DEPLOY={};';

function normalizeBundle(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(DEPLOY_STAMP_PATTERN, DEPLOY_STAMP_PLACEHOLDER);
}

function bundlesMatch(a, b) {
  return normalizeBundle(a) === normalizeBundle(b);
}

function runPowerShell(root) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './inline-html.ps1'];
  const candidates = ['pwsh', 'powershell'];

  for (const bin of candidates) {
    const result = spawnSync(bin, args, {
      cwd: root,
      encoding: 'utf8'
    });

    if (result.error && result.error.code === 'ENOENT') {
      continue;
    }

    return result;
  }

  return {
    status: 1,
    stdout: '',
    stderr: 'Neither "pwsh" nor "powershell" is available on PATH.'
  };
}

function checkStandalone(options) {
  const opts = options || {};
  const root = opts.root || process.cwd();
  const runInliner = opts.runInliner || (() => runPowerShell(root));
  const scriptPath = join(root, 'inline-html.ps1');
  const outputPath = join(root, 'monkeygtd-standalone.html');

  if (!existsSync(scriptPath)) {
    return { ok: false, messages: ['Standalone check failed: inline-html.ps1 was not found.'] };
  }

  if (!existsSync(outputPath)) {
    return { ok: false, messages: ['Standalone check failed: monkeygtd-standalone.html was not found.'] };
  }

  const beforeRaw = readFileSync(outputPath);
  const run = runInliner();

  if ((run.status || 0) !== 0) {
    return {
      ok: false,
      messages: ['Standalone check failed: inline-html.ps1 did not run successfully.'],
      run,
      exitCode: run.status || 1
    };
  }

  const after = readFileSync(outputPath, 'utf8');

  if (!bundlesMatch(beforeRaw.toString('utf8'), after)) {
    return {
      ok: false,
      messages: [
        'Standalone bundle is out of date.',
        'Run ./inline-html.ps1 and commit the updated monkeygtd-standalone.html.'
      ]
    };
  }

  // At most the deploy stamp moved: put the committed file back so a passing
  // check leaves the working tree untouched.
  writeFileSync(outputPath, beforeRaw);
  return { ok: true, messages: ['Standalone bundle check passed (monkeygtd-standalone.html is up to date).'] };
}

function main() {
  const result = checkStandalone();

  if (result.ok) {
    result.messages.forEach(m => console.log(m));
    return;
  }

  result.messages.forEach(m => console.error(m));
  if (result.run?.stdout) process.stdout.write(result.run.stdout);
  if (result.run?.stderr) process.stderr.write(result.run.stderr);
  process.exit(result.exitCode || 1);
}

if (require.main === module) {
  main();
}

module.exports = { normalizeBundle, bundlesMatch, checkStandalone };
