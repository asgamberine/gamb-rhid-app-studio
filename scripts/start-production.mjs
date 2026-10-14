import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.execArgv.includes('--use-system-ca')) {
  const child = spawn(
    process.execPath,
    ['--use-system-ca', ...process.execArgv, fileURLToPath(import.meta.url)],
    {
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (error) => {
      console.error(error.message);
      resolve(1);
    });
  });
  process.exit(exitCode);
}

process.env.ALLOW_OFFICIAL_RHID_PUNCH = 'true';
process.env.NODE_ENV ||= 'production';
process.env.SERVE_STATIC ||= 'true';

await import('../server/index.mjs');
