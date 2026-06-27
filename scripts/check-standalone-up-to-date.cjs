#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = process.cwd();
const scriptPath = join(root, 'inline-html.ps1');
const outputPath = join(root, 'monkeygtd-standalone.html');

function normalize(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function runPowerShell() {
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

if (!existsSync(scriptPath)) {
  console.error('Standalone check failed: inline-html.ps1 was not found.');
  process.exit(1);
}

if (!existsSync(outputPath)) {
  console.error('Standalone check failed: monkeygtd-standalone.html was not found.');
  process.exit(1);
}

const before = readFileSync(outputPath, 'utf8');
const run = runPowerShell();

if ((run.status || 0) !== 0) {
  console.error('Standalone check failed: inline-html.ps1 did not run successfully.');
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  process.exit(run.status || 1);
}

const after = readFileSync(outputPath, 'utf8');

if (normalize(before) !== normalize(after)) {
  console.error('Standalone bundle is out of date.');
  console.error('Run ./inline-html.ps1 and commit the updated monkeygtd-standalone.html.');
  process.exit(1);
}

console.log('Standalone bundle check passed (monkeygtd-standalone.html is up to date).');
