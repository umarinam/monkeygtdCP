const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('body and #app use dynamic viewport height so the status bar stays on-screen on mobile', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');

  // 100vh on mobile browsers is measured against the largest possible viewport
  // (address bar collapsed); with body{overflow:hidden} the last flex child in
  // #app (the #sb status bar) gets clipped below the real, shorter viewport.
  // 100dvh tracks the actual visible viewport and must be declared after the
  // 100vh fallback so unsupported browsers keep the vh value.
  const bodyRuleMatch = css.match(/body\{[^}]*\}/);
  const appRuleMatch = css.match(/#app\{[^}]*\}/);

  assert.notEqual(bodyRuleMatch, null);
  assert.notEqual(appRuleMatch, null);

  const bodyRule = bodyRuleMatch[0];
  const appRule = appRuleMatch[0];

  assert.equal(bodyRule.includes('height:100vh'), true);
  assert.equal(bodyRule.includes('height:100dvh'), true);
  assert.ok(bodyRule.indexOf('height:100vh') < bodyRule.indexOf('height:100dvh'));

  assert.equal(appRule.includes('height:100vh'), true);
  assert.equal(appRule.includes('height:100dvh'), true);
  assert.ok(appRule.indexOf('height:100vh') < appRule.indexOf('height:100dvh'));
});
