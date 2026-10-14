import { spawn } from 'node:child_process';
import { join } from 'node:path';

const backendPort = process.env.BACKEND_PORT ?? process.env.API_PORT ?? '8787';

const developmentOrigins = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:8787',
  'http://localhost:8787',
  process.env.APP_URL,
].filter(Boolean);
const trustedOrigins = [
  ...(process.env.TRUSTED_ORIGINS ?? '').split(','),
  ...developmentOrigins,
].map((value) => value.trim()).filter(Boolean);
const backendEnvironment = {
  ...process.env,
  PORT: String(backendPort),
  API_PORT: String(backendPort),
  HOST: '127.0.0.1',
  SERVE_STATIC: 'false',
  TRUSTED_ORIGINS: [...new Set(trustedOrigins)].join(','),
};
const nodeExecArgs = process.execArgv.includes('--use-system-ca')
  ? process.execArgv
  : ['--use-system-ca', ...process.execArgv];

const cliArgs = process.argv.slice(2);
const viteArgs = [join('node_modules', 'vite', 'bin', 'vite.js'), ...cliArgs];

if (!cliArgs.includes('--port')) {
  const frontendPort = process.env.FRONTEND_PORT
    ?? (process.env.PORT && process.env.PORT !== String(backendPort) ? process.env.PORT : '3000');
  viteArgs.push('--port', String(frontendPort));
}
if (!cliArgs.includes('--host')) {
  viteArgs.push('--host', process.env.HOST ?? '0.0.0.0');
}

const viteEnvironment = {
  ...process.env,
  API_PORT: String(backendPort),
};

const children = [
  spawn(process.execPath, [...nodeExecArgs, '--watch', join('server', 'index.mjs')], {
    env: backendEnvironment,
    stdio: 'inherit',
  }),
  spawn(process.execPath, viteArgs, {
    env: viteEnvironment,
    stdio: 'inherit',
  }),
];

let stopping = false;

function stopChildren(signal = 'SIGTERM') {
  if (stopping) {
    return;
  }
  stopping = true;
  children.forEach((child) => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

children.forEach((child) => {
  child.on('exit', (code, signal) => {
    if (!stopping) {
      stopChildren();
      process.exitCode = code ?? (signal ? 1 : 0);
    }
  });
  child.on('error', (error) => {
    console.error(error.message);
    stopChildren();
    process.exitCode = 1;
  });
});

process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));
