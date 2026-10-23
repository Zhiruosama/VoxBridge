import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Verify the signed artifact: a usage string alone does not permit audio capture
// under the hardened runtime. This check must run after Tauri signs the bundle.
if (process.platform === 'darwin') {
  const app = fileURLToPath(
    new URL('../src-tauri/target/release/bundle/macos/VoxBridge.app', import.meta.url),
  );
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  const entitlements = execFileSync(
    '/usr/bin/codesign',
    ['--display', '--entitlements', '-', '--xml', app],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (!entitlements.trim()) throw new Error('Signed VoxBridge app has no entitlements.');
  const values = JSON.parse(
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: entitlements,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  );
  if (values['com.apple.security.device.audio-input'] !== true)
    throw new Error('Signed VoxBridge app is missing the audio-input entitlement.');
  const usage = execFileSync(
    '/usr/bin/plutil',
    ['-extract', 'NSMicrophoneUsageDescription', 'raw', '-o', '-', `${app}/Contents/Info.plist`],
    { encoding: 'utf8' },
  ).trim();
  if (!usage) throw new Error('Signed VoxBridge app is missing its microphone usage description.');
  console.log('Verified macOS signature, microphone entitlement and usage description.');
}
