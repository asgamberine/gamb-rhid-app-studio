// @vitest-environment node
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

const childProcesses = [];
const mockServers = [];
const temporaryDirectories = [];

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
  }
  for (const server of mockServers.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The integration API did not become healthy.');
}

describe('production authentication session', () => {
  it('keeps a successful login even when a legacy cookie is also present', async () => {
    const mockRhid = createServer((request, response) => {
      if (request.url === '/login.svc/' && request.method === 'POST') {
        const claims = Buffer.from(JSON.stringify({ accessType: 1, cidCustomerId: 42 })).toString('base64url');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          accessToken: `header.${claims}.signature`,
          name: 'Usuário de teste',
          newID: 123,
          isPerson: true,
        }));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise((resolve) => mockRhid.listen(0, '127.0.0.1', resolve));
    mockServers.push(mockRhid);

    const mockAddress = mockRhid.address();
    const mockPort = typeof mockAddress === 'object' && mockAddress ? mockAddress.port : 0;
    const apiPort = await availablePort();
    const dataDirectory = await mkdtemp(join(tmpdir(), 'gamb-rhid-auth-'));
    temporaryDirectories.push(dataDirectory);

    const api = spawn(process.execPath, ['server/index.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(apiPort),
        SERVE_STATIC: 'false',
        TRUST_PROXY: 'true',
        COOKIE_SECURE: 'true',
        TRUSTED_ORIGINS: 'https://gamberine.com.br',
        RHID_PORTAL_URL: `http://127.0.0.1:${mockPort}`,
        DATA_DIR: dataDirectory,
      },
      stdio: 'pipe',
    });
    childProcesses.push(api);

    const apiUrl = `http://127.0.0.1:${apiPort}`;
    await waitForHealth(apiUrl);

    const loginResponse = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://gamberine.com.br',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ email: 'usuario@example.com', password: 'senha', domain: 'empresa' }),
    });
    const loginPayload = await loginResponse.json();
    const setCookie = loginResponse.headers.get('set-cookie') ?? '';

    expect(loginResponse.status).toBe(200);
    expect(loginPayload.authenticated).toBe(true);
    expect(setCookie).toContain('gamb_rhid_session_v2=');
    expect(setCookie).toContain('Secure');
    expect(setCookie).not.toContain('Domain=');

    const freshCookie = setCookie.split(';')[0];
    const sessionResponse = await fetch(`${apiUrl}/api/auth/session`, {
      headers: {
        Origin: 'https://gamberine.com.br',
        Cookie: `gamb_rhid_session=legacy-invalid-session; ${freshCookie}`,
      },
    });
    const sessionPayload = await sessionResponse.json();

    expect(sessionResponse.status).toBe(200);
    expect(sessionPayload).toMatchObject({
      authenticated: true,
      email: 'usuario@example.com',
      domain: 'empresa',
      personId: 123,
    });
  });
});
