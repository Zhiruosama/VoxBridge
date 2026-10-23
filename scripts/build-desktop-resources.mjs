import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.platform === 'darwin') {
  const script = fileURLToPath(new URL('../native/macos/virtual-mic/build.sh', import.meta.url));
  const result = spawnSync('bash', [script], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
