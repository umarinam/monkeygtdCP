const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeBundle,
  bundlesMatch,
  checkStandalone
} = require(path.join(process.cwd(), 'scripts/check-standalone-up-to-date.cjs'));

function stamp(deployedAt, commit) {
  return `<script>window.__MGTD_STANDALONE_DEPLOY={deployedAt:'${deployedAt}',commit:'${commit}'};</script>`;
}

function bundle(stampTag, body = 'const x = 1;') {
  return `<!DOCTYPE html>\r\n<html>\r\n<body>\r\n${stampTag}\r\n<script>\r\n${body}\r\nconst deployMeta = globalThis.__MGTD_STANDALONE_DEPLOY || {};\r\n</script>\r\n</body>\r\n</html>\r\n`;
}

const PARENT_STAMP = stamp('2026-09-27T11:52:06+05:00', '167cfd6');
const OWN_STAMP = stamp('2026-09-27T12:00:47+05:00', '15861e1');

test('bundles that differ only in the deploy stamp match', () => {
  assert.equal(bundlesMatch(bundle(PARENT_STAMP), bundle(OWN_STAMP)), true);
  // Built outside git (inline-html.ps1 falls back to empty values).
  assert.equal(bundlesMatch(bundle(PARENT_STAMP), bundle(stamp('', ''))), true);
  // Existing CRLF/LF tolerance is kept.
  assert.equal(bundlesMatch(bundle(PARENT_STAMP), bundle(OWN_STAMP).replace(/\r\n/g, '\n')), true);
});

test('bundles that differ in real content do not match, even with the same stamp', () => {
  assert.equal(bundlesMatch(bundle(OWN_STAMP), bundle(OWN_STAMP, 'const x = 2;')), false);
  assert.equal(bundlesMatch(bundle(PARENT_STAMP), bundle(OWN_STAMP, 'const x = 2;')), false);
  // The app code that reads the stamp is ordinary content, not normalized away.
  assert.equal(
    bundlesMatch(bundle(OWN_STAMP), bundle(OWN_STAMP).replace('__MGTD_STANDALONE_DEPLOY || {}', '__MGTD_STANDALONE_DEPLOY || null')),
    false
  );
  // Removing the stamp script entirely is a real change too.
  assert.equal(bundlesMatch(bundle(OWN_STAMP), bundle('')), false);
});

test('normalizeBundle blanks only the stamp values', () => {
  const out = normalizeBundle(bundle(OWN_STAMP));
  assert.equal(out.includes('15861e1'), false);
  assert.equal(out.includes('<script>window.__MGTD_STANDALONE_DEPLOY={};</script>'), true);
  assert.equal(out.includes('globalThis.__MGTD_STANDALONE_DEPLOY || {}'), true);
  assert.equal(out.includes('\r'), false);
  assert.equal(normalizeBundle(null), '');
});

test('the stamp inline-html.ps1 emits is the one the check normalizes', () => {
  // Guards against the stamp format changing in the inliner and silently
  // turning the normalization into a no-op (which would re-break CI).
  const ps1 = fs.readFileSync(path.join(process.cwd(), 'inline-html.ps1'), 'utf8');
  const m = ps1.match(/\$deployScript = "(.*)"/);
  assert.ok(m, 'Expected $deployScript template in inline-html.ps1');
  const render = (at, commit) => m[1].replace('$deployAtEscaped', at).replace('$deployCommitEscaped', commit);

  assert.equal(render('2026-01-01T00:00:00+00:00', 'aaaaaaa'), stamp('2026-01-01T00:00:00+00:00', 'aaaaaaa'));
  assert.equal(bundlesMatch(bundle(render('2026-01-01T00:00:00+00:00', 'aaaaaaa')), bundle(render('2026-02-02T00:00:00+00:00', 'bbbbbbb'))), true);
});

test('the committed standalone bundle carries exactly one normalizable stamp', () => {
  const committed = fs.readFileSync(path.join(process.cwd(), 'monkeygtd-standalone.html'), 'utf8');
  const stamps = committed.match(/window\.__MGTD_STANDALONE_DEPLOY=\{[^}]*\};/g) || [];
  assert.equal(stamps.length, 1);

  const restamped = committed.replace(stamps[0], "window.__MGTD_STANDALONE_DEPLOY={deployedAt:'2099-01-01T00:00:00+00:00',commit:'fffffff'};");
  assert.notEqual(restamped, committed);
  assert.equal(bundlesMatch(committed, restamped), true);
  assert.equal(bundlesMatch(committed, restamped.replace('</body>', '<!-- drift --></body>')), false);
});

function withTempProject(bundleText, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgtd-standalone-check-'));
  try {
    fs.writeFileSync(path.join(dir, 'inline-html.ps1'), '# fake');
    fs.writeFileSync(path.join(dir, 'monkeygtd-standalone.html'), bundleText);
    return fn(dir, path.join(dir, 'monkeygtd-standalone.html'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('checkStandalone passes on a stamp-only rebuild and restores the committed file', () => {
  const committed = bundle(PARENT_STAMP);
  withTempProject(committed, (root, outputPath) => {
    const result = checkStandalone({
      root,
      runInliner: () => {
        fs.writeFileSync(outputPath, bundle(OWN_STAMP));
        return { status: 0 };
      }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.messages, ['Standalone bundle check passed (monkeygtd-standalone.html is up to date).']);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), committed);
  });
});

test('checkStandalone fails on real drift and leaves the regenerated bundle to commit', () => {
  withTempProject(bundle(PARENT_STAMP), (root, outputPath) => {
    const regenerated = bundle(OWN_STAMP, 'const x = 2;');
    const result = checkStandalone({
      root,
      runInliner: () => {
        fs.writeFileSync(outputPath, regenerated);
        return { status: 0 };
      }
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.messages, [
      'Standalone bundle is out of date.',
      'Run ./inline-html.ps1 and commit the updated monkeygtd-standalone.html.'
    ]);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), regenerated);
  });
});

test('checkStandalone reports an inliner failure with its exit code', () => {
  withTempProject(bundle(PARENT_STAMP), (root) => {
    const run = { status: 3, stdout: 'out', stderr: 'err' };
    const result = checkStandalone({ root, runInliner: () => run });

    assert.equal(result.ok, false);
    assert.deepEqual(result.messages, ['Standalone check failed: inline-html.ps1 did not run successfully.']);
    assert.equal(result.exitCode, 3);
    assert.equal(result.run, run);
  });
});

test('checkStandalone reports missing inputs without running the inliner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgtd-standalone-check-'));
  try {
    let ran = 0;
    const runInliner = () => { ran += 1; return { status: 0 }; };

    assert.deepEqual(checkStandalone({ root: dir, runInliner }).messages, ['Standalone check failed: inline-html.ps1 was not found.']);
    fs.writeFileSync(path.join(dir, 'inline-html.ps1'), '# fake');
    assert.deepEqual(checkStandalone({ root: dir, runInliner }).messages, ['Standalone check failed: monkeygtd-standalone.html was not found.']);
    assert.equal(ran, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
