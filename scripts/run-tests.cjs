#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((v) => v.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function isTestFile(path) {
  return (
    path.endsWith('.test.cjs') ||
    path.endsWith('.test.js') ||
    path.endsWith('.spec.cjs') ||
    path.endsWith('.spec.js')
  );
}

const suite = getArg('suite');
const rootDir = suite === 'unit' ? 'tests/unit' : suite === 'integration' ? 'tests/integration' : 'tests';

if (!existsSync(rootDir)) {
  console.log(`No ${rootDir} directory found. Skipping test execution.`);
  process.exit(0);
}

const testFiles = walk(rootDir).filter(isTestFile);

if (testFiles.length === 0) {
  console.log(`No test files found under ${rootDir}. Skipping test execution.`);
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status || 0);
