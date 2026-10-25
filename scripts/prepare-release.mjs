import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import semver from 'semver';

const mode = process.argv[2];
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const tag = `v${pkg.version}`;
if (pkg.version !== config.version || (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag)) {
  throw new Error('Release tag and application versions must match');
}
if (mode === 'feed-check') {
  const previous = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const next = JSON.parse(await readFile('release-assets/latest.json', 'utf8'));
  if (!semver.valid(previous.version) || !semver.valid(next.version)) throw new Error('Invalid update feed version');
  await writeFile(process.env.GITHUB_OUTPUT, `advance=${semver.gte(next.version, previous.version)}\n`, { flag: 'a' });
} else if (mode === 'validate') {
  await readFile(`docs/releases/${tag}.md`);
} else if (mode === 'collect') {
  const platform = process.platform === 'win32' ? 'windows-x64' : 'macos-arm64';
  const output = 'release-assets';
  await mkdir(output, { recursive: true });
  const bundle = 'src-tauri/target/release/bundle';
  const directories = process.platform === 'win32' ? ['nsis'] : ['dmg', 'macos'];
  const names = [];
  for (const directory of directories) {
    for (const name of await readdir(join(bundle, directory))) {
      if (!/\.(exe|dmg|app\.tar\.gz)(\.sig)?$/.test(name)) continue;
      await copyFile(join(bundle, directory, name), join(output, name));
      names.push(name);
    }
  }
  const update = names.find(name => process.platform === 'win32' ? name.endsWith('.exe') : name.endsWith('.app.tar.gz'));
  if (!update || !names.includes(`${update}.sig`)) throw new Error('Signed updater package is missing');
  const sums = [];
  for (const name of names.sort()) {
    const digest = createHash('sha256').update(await readFile(join(output, name))).digest('hex');
    sums.push(`${digest}  ${name}`);
  }
  await writeFile(join(output, `SHA256SUMS-${platform}.txt`), `${sums.join('\n')}\n`);
} else if (mode === 'manifest') {
  const directory = 'release-assets';
  const names = await readdir(directory);
  const windows = names.filter(name => name.endsWith('.exe'));
  const mac = names.filter(name => name.endsWith('.app.tar.gz'));
  if (windows.length !== 1 || mac.length !== 1) throw new Error('Expected exactly one Windows and one Mac updater');
  const platforms = {};
  for (const [target, name] of [['windows-x86_64', windows[0]], ['darwin-aarch64', mac[0]]]) {
    const signature = (await readFile(join(directory, `${name}.sig`), 'utf8')).trim();
    if (!signature) throw new Error('Empty updater signature');
    platforms[target] = { signature, url: `https://github.com/Zhiruosama/VoxBridge/releases/download/${tag}/${encodeURIComponent(basename(name))}` };
  }
  // Validate every checksum before publishing; separate names prevent platform collisions.
  for (const platform of ['windows-x64', 'macos-arm64']) {
    for (const line of (await readFile(join(directory, `SHA256SUMS-${platform}.txt`), 'utf8')).trim().split('\n')) {
      const [expected, name] = line.split('  ');
      if (!name || basename(name) !== name || createHash('sha256').update(await readFile(join(directory, name))).digest('hex') !== expected) throw new Error('Release checksum mismatch');
    }
  }
  await writeFile(join(directory, 'latest.json'), JSON.stringify({ version: pkg.version, notes: `VoxBridge ${pkg.version}`, pub_date: new Date().toISOString(), platforms }, null, 2) + '\n');
} else { throw new Error('Expected validate, collect or manifest'); }
