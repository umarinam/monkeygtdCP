const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadParseSmart() {
  const source = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const sandbox = { console, Date, Math, JSON };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports={parseSmart};`, sandbox, { filename: 'utils.js' });
  return sandbox.__exports.parseSmart;
}

test('parseSmart ignores hashtag fragments inside markdown link targets', () => {
  const parseSmart = loadParseSmart();
  const input = 'UpSkill project for Abhinav [fa:onenote](onenote:https://d.docs.live.net/389065471FA18896/Documents/Bentley2026/Scripts.one#Asad%20for%20Abhinav&section-id={AD2ECFA8-3C34-4953-A725-C542F4207E63}&page-id={70CB4199-2C35-4565-AE89-C2276F2B9E5F})';

  const parsed = parseSmart(input);

  assert.equal(JSON.stringify(parsed.tags), '[]');
  assert.equal(parsed.content, input);
});

test('parseSmart still extracts explicit tag outside links', () => {
  const parseSmart = loadParseSmart();
  const input = 'Review this #upskill [fa:onenote](onenote:https://example.com/page#Anchor)';

  const parsed = parseSmart(input);

  assert.equal(JSON.stringify(parsed.tags), '["upskill"]');
});

test('parseSmart does not parse URL fragments as tags even when markdown link is malformed', () => {
  const parseSmart = loadParseSmart();
  const input = 'UpSkill project [fa:onenote](onenote:https://example.com/Scripts.one#Asad';

  const parsed = parseSmart(input);

  assert.equal(JSON.stringify(parsed.tags), '[]');
});
