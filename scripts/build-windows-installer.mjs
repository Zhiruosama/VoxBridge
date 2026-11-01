import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const args = process.argv.slice(2);
execFileSync(process.execPath, [cli, 'build', '--bundles', 'nsis', ...args], {
  cwd: root,
  stdio: 'inherit',
});
const targetIndex = args.indexOf('--target');
const target = targetIndex >= 0 ? args[targetIndex + 1] : '';
const architecture = target
  ? target.startsWith('aarch64')
    ? 'arm64'
    : 'x64'
  : process.arch === 'arm64'
    ? 'arm64'
    : 'x64';
const profile = args.includes('--debug') ? 'debug' : 'release';
const targetDir = resolve(root, 'src-tauri/target', target, profile);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const output = join(targetDir, `bundle/nsis/VoxBridge_${version}_${architecture}-setup.exe`);
const staging = join(root, 'native/windows/.build', `setup-${architecture}-${profile}`);
mkdirSync(staging, { recursive: true });
const payload = join(staging, 'payload.exe');
const wrapper = join(staging, 'VoxBridge-bootstrap.exe');
copyFileSync(output, payload);
const compiler = join(process.env.LOCALAPPDATA, 'tauri/NSIS/makensis.exe');
// GNU builds load WebView2 dynamically; the bootstrap UI runs outside the
// installed app directory and must carry the loader beside its executable.
const webviewLoader = join(targetDir, 'WebView2Loader.dll');
execFileSync(
  compiler,
  [
    '/V2',
    `/DSETUP_UI=${join(targetDir, 'voxbridge.exe')}`,
    `/DSETUP_PAYLOAD=${payload}`,
    `/DSETUP_OUTPUT=${wrapper}`,
    `/DSETUP_ICON=${join(root, 'src-tauri/icons/icon.ico')}`,
    ...(existsSync(webviewLoader) ? [`/DSETUP_WEBVIEW2_LOADER=${webviewLoader}`] : []),
    join(root, 'native/windows/setup-wrapper.nsi'),
  ],
  { cwd: root, stdio: 'inherit' },
);
const signed =
  existsSync(output + '.sig') &&
  Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);
if (existsSync(output + '.sig')) unlinkSync(output + '.sig');
copyFileSync(wrapper, output);
if (signed) {
  const signingEnv = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
  };
  if (signingEnv.TAURI_SIGNING_PRIVATE_KEY && existsSync(signingEnv.TAURI_SIGNING_PRIVATE_KEY)) {
    signingEnv.TAURI_SIGNING_PRIVATE_KEY_PATH = signingEnv.TAURI_SIGNING_PRIVATE_KEY;
    delete signingEnv.TAURI_SIGNING_PRIVATE_KEY;
  }
  // Sign the final outer installer, including the version-bound trusted comment.
  execFileSync(process.execPath, [cli, 'signer', 'sign', '--app-version', version, output], {
    cwd: root,
    stdio: 'inherit',
    env: signingEnv,
  });
}
console.log(`Built VoxBridge frontend installer: ${output}`);
