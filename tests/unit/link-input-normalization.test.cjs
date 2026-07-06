const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadNormalizePromptLink() {
  const source = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const sandbox = { console, Date, Math, JSON };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports={normalizePromptLink};`, sandbox, { filename: 'utils.js' });
  return sandbox.__exports.normalizePromptLink;
}

test('normalizePromptLink extracts clean onenote protocol link and drops trailing end marker', () => {
  const normalizePromptLink = loadNormalizePromptLink();
  const raw = 'https://onedrive.live.com/view.aspx?resid=389065471FA18896%21s5b1bcab3350b4166bf66c4537f47fd1f&id=documents&wd=target%28Scripts.one%7CAD2ECFA8-3C34-4953-A725-C542F4207E63%2FAsad%20for%20Abhinav%7C70CB4199-2C35-4565-AE89-C2276F2B9E5F%2F%29&wdpartid={4982FF96-4D19-4589-A7DE-769C0E7020F5}{1}&wdsectionfileid=389065471FA18896!sfb1a18db70ef41c1b03c7f2ce000e28b&end onenote:https://d.docs.live.net/389065471FA18896/Documents/Bentley2026/Scripts.one#Asad%20for%20Abhinav&section-id={AD2ECFA8-3C34-4953-A725-C542F4207E63}&page-id={70CB4199-2C35-4565-AE89-C2276F2B9E5F}&end';
  const normalized = normalizePromptLink(raw, 'onenote');
  assert.equal(normalized, 'onenote:https://d.docs.live.net/389065471FA18896/Documents/Bentley2026/Scripts.one#Asad%20for%20Abhinav&section-id={AD2ECFA8-3C34-4953-A725-C542F4207E63}&page-id={70CB4199-2C35-4565-AE89-C2276F2B9E5F}');
});

test('normalizePromptLink extracts clean outlook protocol from noisy legacy text', () => {
  const normalizePromptLink = loadNormalizePromptLink();
  const raw = "Titas Lukaitis in Teams: Titas Lukaitis sent a message [link: <i class='icon-envelope-alt'></i>|outlook:00000000F8774E51F57D274398F5CCA2CB3B913F0700234F456FBC8AF54BA08AB663CA86D36900000746B0DE0000E141C43A8481914698BF8E74F56BD1850009AA9830AA0000]";
  const normalized = normalizePromptLink(raw, 'email');
  assert.equal(normalized, 'outlook:00000000F8774E51F57D274398F5CCA2CB3B913F0700234F456FBC8AF54BA08AB663CA86D36900000746B0DE0000E141C43A8481914698BF8E74F56BD1850009AA9830AA0000');
});

test('normalizePromptLink prefixes raw file path with start protocol', () => {
  const normalizePromptLink = loadNormalizePromptLink();
  assert.equal(normalizePromptLink('D:/Docs/spec.docx', 'file'), 'start:D:/Docs/spec.docx');
});
