const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMd() {
  const source = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const sandbox = { console, Date, Math, JSON };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports={md};`, sandbox, { filename: 'utils.js' });
  return sandbox.__exports.md;
}

test('md autolinks custom protocols', () => {
  const md = loadMd();
  const html = md('Open outlook:inbox and onenote:https://example');
  assert.equal(html.includes('href="outlook:inbox"'), true);
  assert.equal(html.includes('href="onenote:https://example"'), true);
});

test('md allows previously blocked protocols as links', () => {
  const md = loadMd();
  const html = md('Do not link javascript:alert(1)');
  assert.equal(html.includes('href="javascript:alert(1)"'), true);
});

test('md markdown links allow internal task anchors and arbitrary schemes', () => {
  const md = loadMd();
  const html = md('[Task](#task-abc123) [Mail](mailto:test@example.com) [Proto](foo:bar)');
  assert.equal(html.includes('href="#task-abc123"'), true);
  assert.equal(html.includes('href="mailto:test@example.com"'), true);
  assert.equal(html.includes('href="foo:bar"'), true);
});

test('md preserves markdown link label for outlook protocol links', () => {
  const md = loadMd();
  const html = md('Outlooks [My Email](outlook:00000000F8774E51F57D274398F5CCA2CB3B913F0700234F456FBC8AF54BA08AB663CA86D36900000746B0DE0000E141C43A8481914698BF8E74F56BD1850009A742D4630000)');
  assert.equal(html.includes('>My Email</a>'), true);
  assert.equal(html.includes('href="outlook:00000000F8774E51F57D274398F5CCA2CB3B913F0700234F456FBC8AF54BA08AB663CA86D36900000746B0DE0000E141C43A8481914698BF8E74F56BD1850009A742D4630000"'), true);
});
