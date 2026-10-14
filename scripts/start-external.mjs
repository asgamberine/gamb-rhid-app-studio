import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.cwd());
const dataDir = resolve(process.env.DATA_DIR ?? join(root, '.data'));
const credentialsPath = join(dataDir, 'external-access.json');
const statePath = join(dataDir, 'external-access-state.json');
const port = Number(process.env.API_PORT ?? 8787);
const publicBase = normalizeBasePath(process.env.PUBLIC_BASE ?? '/gamb_rhid/');
const cloudflaredCommand = findCloudflared();
const nodeExecArgs = process.execArgv.includes('--use-system-ca')
  ? process.execArgv
  : ['--use-system-ca', ...process.execArgv];
const children = [];
let stopping = false;

function normalizeBasePath(value) {
  const path = String(value || '/').trim();
  if (path === '/') {
    return '/';
  }
  const leading = path.startsWith('/') ? path : `/${path}`;
  return leading.endsWith('/') ? leading : `${leading}/`;
}

function findCloudflared() {
  if (process.env.CLOUDFLARED_BIN) {
    return process.env.CLOUDFLARED_BIN;
  }
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const where = spawnSync(locator, ['cloudflared'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const located = where.status === 0 ? where.stdout.split(/\r?\n/).find(Boolean)?.trim() : '';
  if (located) {
    return located;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe');
  }
  return 'cloudflared';
}

async function loadCredentials() {
  try {
    const stored = JSON.parse(await readFile(credentialsPath, 'utf8'));
    if (stored.username && String(stored.password ?? '').length >= 16) {
      return stored;
    }
  } catch {
    // Create a new credential file below.
  }
  const credentials = {
    username: 'gamb',
    password: randomBytes(24).toString('base64url'),
    createdAt: new Date().toISOString(),
  };
  await mkdir(dirname(credentialsPath), { recursive: true });
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  return credentials;
}

function restrictDataDirectory() {
  if (process.platform !== 'win32') {
    return;
  }
  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const sid = identity.stdout.match(/"([^"]+)"\s*$/)?.[1];
  if (!sid) {
    console.warn('Aviso: nao foi possivel identificar o SID para restringir as ACLs de .data.');
    return;
  }
  const rootAcl = spawnSync('icacls.exe', [
    dataDir,
    '/inheritance:r',
    '/grant:r',
    `*${sid}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F',
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const childAcl = spawnSync('icacls.exe', [
    join(dataDir, '*'),
    '/reset',
    '/T',
    '/C',
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (rootAcl.status !== 0 || childAcl.status !== 0) {
    const error = [rootAcl.stderr, childAcl.stderr].filter(Boolean).join(' ').trim();
    console.warn(`Aviso: nao foi possivel restringir completamente as ACLs de .data: ${error}`);
  }
}

function runBuild() {
  const npmExecutable = process.env.npm_execpath ? process.execPath : 'npm';
  const npmArguments = process.env.npm_execpath
    ? [process.env.npm_execpath, 'run', 'build']
    : ['run', 'build'];
  const build = spawnSync(npmExecutable, npmArguments, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (build.status !== 0) {
    throw new Error(
      `O build falhou; o acesso externo nao foi iniciado.${build.error ? ` ${build.error.message}` : ''}`,
    );
  }
}

function basicAuthorization(credentials) {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
}

async function waitForServer(credentials) {
  const authorization = basicAuthorization(credentials);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Authorization: authorization },
      });
      if (response.ok) {
        const health = await response.json().catch(() => null);
        if (health?.externalAccessProtected === true) {
          return;
        }
        throw new Error(
          `A porta ${port} ja esta ocupada por uma instancia sem a protecao de acesso externo.`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('ja esta ocupada')) {
        throw error;
      }
      // The process may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`O servidor nao respondeu na porta ${port}.`);
}

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
  rm(statePath, { force: true }).catch(() => {});
}

await access(cloudflaredCommand).catch(() => {
  throw new Error(
    'cloudflared nao encontrado. Instale com: winget install --id Cloudflare.cloudflared --exact',
  );
});

const credentials = await loadCredentials();
restrictDataDirectory();
await rm(statePath, { force: true });
runBuild();

const server = spawn(process.execPath, [...nodeExecArgs, join(root, 'scripts', 'start-production.mjs')], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    SERVE_STATIC: 'true',
    HOST: '127.0.0.1',
    COOKIE_SECURE: 'true',
    TRUST_PROXY: 'true',
    SESSION_MAX_AGE_SECONDS: process.env.SESSION_MAX_AGE_SECONDS ?? '43200',
    EXTERNAL_ACCESS_USERNAME: credentials.username,
    EXTERNAL_ACCESS_PASSWORD: credentials.password,
  },
  stdio: 'inherit',
  windowsHide: true,
});
children.push(server);
try {
  await waitForServer(credentials);
} catch (error) {
  stopChildren();
  throw error;
}

const tunnel = spawn(cloudflaredCommand, [
  'tunnel',
  '--no-autoupdate',
  '--url',
  `http://127.0.0.1:${port}`,
], {
  cwd: root,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
children.push(tunnel);

let published = false;
let tunnelOutput = '';
function relayTunnelOutput(chunk, target) {
  const text = chunk.toString();
  target.write(text);
  tunnelOutput = `${tunnelOutput}${text}`.slice(-8_192);
  const match = tunnelOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (!match || published) {
    return;
  }
  published = true;
  const origin = match[0];
  const url = `${origin}${publicBase}`;
  writeFile(statePath, `${JSON.stringify({
    url,
    origin,
    username: credentials.username,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 }).catch(console.error);
  console.log('\nAcesso externo iniciado:');
  console.log(`URL: ${url}`);
  console.log(`Usuario: ${credentials.username}`);
  console.log(`Senha: ${credentials.password}`);
  console.log('Mantenha este processo em execucao para conservar o acesso.\n');
}

tunnel.stdout.on('data', (chunk) => relayTunnelOutput(chunk, process.stdout));
tunnel.stderr.on('data', (chunk) => relayTunnelOutput(chunk, process.stderr));

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping) {
      stopChildren();
      process.exitCode = code ?? 1;
    }
  });
  child.on('error', (error) => {
    console.error(error.message);
    stopChildren();
    process.exitCode = 1;
  });
}

process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));
