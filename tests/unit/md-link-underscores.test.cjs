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

const md = loadMd();
const link = (href, label = href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

test('a Markdown link keeps underscores in its URL instead of italicizing them', () => {
  assert.equal(md('[doc](https://ex.com/a_b_c)'), link('https://ex.com/a_b_c', 'doc'));
  assert.equal(md('[a](https://x.com/__init__)'), link('https://x.com/__init__', 'a'));
});

test('a bare URL with underscores is linked in full', () => {
  assert.equal(md('https://ex.com/my_page_name'), link('https://ex.com/my_page_name'));
});

test('a bare URL with asterisks is linked in full', () => {
  assert.equal(md('https://x.com/a*b*c'), link('https://x.com/a*b*c'));
});

test('underscores in a query string survive, and & stays escaped', () => {
  assert.equal(
    md('https://x.com/q?a_b=1&c_d=2'),
    link('https://x.com/q?a_b=1&amp;c_d=2')
  );
});

test('a URL inside inline code is not mangled', () => {
  assert.equal(md('`https://a_b_c`'), `<code>${link('https://a_b_c')}</code>`);
});

test('link labels still get bold and italic', () => {
  assert.equal(
    md('[**bold** _label_](https://x.com/a_b)'),
    link('https://x.com/a_b', '<strong>bold</strong> <em>label</em>')
  );
});

test('formatting around a URL still applies, without the markers becoming part of the URL', () => {
  assert.equal(md('**https://x.com**'), `<strong>${link('https://x.com')}</strong>`);
  assert.equal(md('_https://x.com_'), `<em>${link('https://x.com')}</em>`);
  assert.equal(md('*https://x.com/a_b_c*'), `<em>${link('https://x.com/a_b_c')}</em>`);
  assert.equal(md('~~https://x.com~~'), `<del>${link('https://x.com')}</del>`);
  assert.equal(md('**see [doc](https://x.com/a_b) now**'), `<strong>see ${link('https://x.com/a_b', 'doc')} now</strong>`);
});

test('underscores outside URLs behave as before', () => {
  assert.equal(md('my_file_name'), 'my<em>file</em>name');
  assert.equal(
    md('snake_case_name and https://x.com/a_b'),
    `snake<em>case</em>name and ${link('https://x.com/a_b')}`
  );
});

test('blocked schemes are still never linked, and a blocked Markdown link shows exactly as typed', () => {
  assert.equal(md('[x](javascript:alert_1_)'), '[x](javascript:alert_1_)');
  assert.equal(md('javascript:alert(1)').includes('href='), false);
  assert.equal(md('[f](file:///tmp/a_b_c.txt)').includes('href='), false);
});

test('a scheme-like word right before a Markdown link does not swallow the link', () => {
  assert.equal(md('foo:[doc](https://x)'), `foo:${link('https://x', 'doc')}`);
});
