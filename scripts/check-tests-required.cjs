#!/usr/bin/env node

const { execSync } = require('node:child_process');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((v) => v.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

function getChangedFiles(baseRef, headRef) {
  const range = baseRef && headRef ? `${baseRef}...${headRef}` : 'HEAD~1...HEAD';

  try {
    const raw = execSync(`git diff --name-only ${range}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return raw.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    try {
      const raw = execSync('git diff --name-only --cached', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return raw.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}

function isSourceFile(path) {
  if (!path) return false;
  return (
    path === 'app.html' ||
    path === 'styles.css' ||
    path.startsWith('js/')
  );
}

function isTestFile(path) {
  if (!path) return false;
  return (
    path.startsWith('tests/') ||
    path.endsWith('.test.cjs') ||
    path.endsWith('.test.js') ||
    path.endsWith('.spec.cjs') ||
    path.endsWith('.spec.js')
  );
}

const base = getArg('base') || process.env.BASE_SHA || '';
const head = getArg('head') || process.env.HEAD_SHA || '';
const changedFiles = getChangedFiles(base, head);

const sourceChanged = changedFiles.some(isSourceFile);
const testsChanged = changedFiles.some(isTestFile);

if (!sourceChanged) {
  console.log('No source files changed. Test-policy gate passed.');
  process.exit(0);
}

if (testsChanged) {
  console.log('Source and test files changed together. Test-policy gate passed.');
  process.exit(0);
}

console.error('Test-policy gate failed.');
console.error('Source files changed but no test files were added or modified.');
console.error('Add or update tests in tests/** or *.{test,spec}.js|cjs before merging.');
process.exit(1);
