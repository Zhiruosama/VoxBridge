import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = fileURLToPath(new URL('./prepare-release.mjs', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'voxbridge-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'src-tauri'));
  mkdirSync(join(directory, 'release-assets'));
  writeFileSync(join(directory, 'package.json'), '{"version":"0.3.0"}');
  writeFileSync(join(directory, 'src-tauri/tauri.conf.json'), '{"version":"0.3.0"}');
  const names = ['VoxBridge_0.3.0_x64-setup.exe', 'VoxBridge.app.tar.gz'];
  names.forEach((name, i) => {
    const data = Buffer.from(`fixture-${i}`);
    writeFileSync(join(directory, 'release-assets', name), data);
    writeFileSync(join(directory, 'release-assets', name + '.sig'), 'fixture-signature');
    writeFileSync(join(directory, 'release-assets', `SHA256SUMS-${i ? 'macos-arm64' : 'windows-x64'}.txt`), `${createHash('sha256').update(data).digest('hex')}  ${name}\n`);
  });
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.3.0', ...env } });
  return { directory, run, names };
}
test('combines both platform updates without losing platform-specific checksum files', t => {
  const f = fixture(t);
  assert.equal(f.run(['manifest']).status, 0);
  const manifest = JSON.parse(readFileSync(join(f.directory, 'release-assets/latest.json')));
  assert.equal(manifest.version, '0.3.0');
  assert.deepEqual(Object.keys(manifest.platforms), ['windows-x86_64', 'darwin-aarch64']);
  assert.match(manifest.platforms['windows-x86_64'].url, /releases\/download\/v0.3.0\/VoxBridge_0.3.0_x64-setup.exe$/);
});
test('refuses corrupted artifacts and missing updater signatures', t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, 'release-assets', f.names[0]), 'corrupted');
  assert.notEqual(f.run(['manifest']).status, 0);
  rmSync(join(f.directory, 'release-assets', f.names[0] + '.sig'));
  assert.notEqual(f.run(['manifest']).status, 0);
});
test('rejects mismatched release tag and application version', t => {
  const f = fixture(t);
  assert.notEqual(f.run(['manifest'], { GITHUB_REF_NAME: 'v0.4.0' }).status, 0);
});
test('does not downgrade the update feed when an older tag is released', t => {
  const f = fixture(t);
  assert.equal(f.run(['manifest']).status, 0);
  const previous = join(f.directory, 'previous.json');
  const output = join(f.directory, 'outputs');
  writeFileSync(previous, '{"version":"0.4.0"}');
  assert.equal(f.run(['feed-check', previous], { GITHUB_OUTPUT: output }).status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'advance=false\n');
});
