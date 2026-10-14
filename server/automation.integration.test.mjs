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
      // Server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de integracao nao ficou saudavel.');
}

function getTodayRhidPrefix() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).replaceAll('-', '');
}

function getTodayIsoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

describe('Gamb RH ID 1.1 - Automacoes independentes do navegador', () => {
  it('executa retorno de almoco e segunda saida com navegador fechado, mantendo idempotencia estrita', async () => {
    let mockPunches = [];
    let punchSubmissionCount = 0;

    const todayPrefix = getTodayRhidPrefix();
    const todayIso = getTodayIsoDate();

    const mockRhid = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/login.svc/' && request.method === 'POST') {
        const claims = Buffer.from(JSON.stringify({ accessType: 1, cidCustomerId: 100 })).toString('base64url');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          accessToken: `header.${claims}.signature`,
          name: 'Funcionario Teste',
          newID: 999,
          isPerson: true,
        }));
        return;
      }

      if (url.pathname === '/ponto_diario' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          status: 1,
          retorno: {
            idPerson: 999,
            afdt: mockPunches.map((item, idx) => ({
              idAfd: 1000 + idx,
              dateTimeStr: item.dateTimeStr,
              latitude: item.latitude ?? -19.9328,
              longitude: item.longitude ?? -43.9387,
            })),
          },
        }));
        return;
      }

      if (url.pathname === '/marcacao_web' && request.method === 'POST') {
        punchSubmissionCount += 1;
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const punchTimestamp = Number(payload?.position?.timestamp);
        const punchDate = Number.isFinite(punchTimestamp) ? new Date(punchTimestamp) : new Date();
        const nowIso = punchDate.toISOString();
        const punchHours = String(punchDate.getHours()).padStart(2, '0');
        const punchMinutes = String(punchDate.getMinutes()).padStart(2, '0');
        const punchSeconds = String(punchDate.getSeconds()).padStart(2, '0');
        const nowFormatted = `${todayPrefix}${punchHours}${punchMinutes}${punchSeconds}`;
        mockPunches.push({
          dateTimeStr: nowFormatted,
          latitude: Number(payload.latitude) || -19.9328,
          longitude: Number(payload.longitude) || -43.9387,
        });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          status: 1,
          retorno: {
            datetime: nowIso,
            hash: `hash-${punchSubmissionCount}`,
          },
        }));
        return;
      }

      response.writeHead(404).end();
    });

    await new Promise((resolve) => mockRhid.listen(0, '127.0.0.1', resolve));
    mockServers.push(mockRhid);

    const mockPort = mockRhid.address().port;
    const apiPort = await availablePort();
    const dataDirectory = await mkdtemp(join(tmpdir(), 'gamb-rhid-auto-'));
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
        RHID_REPP_URL: `http://127.0.0.1:${mockPort}`,
        DATA_DIR: dataDirectory,
        ALLOW_OFFICIAL_RHID_PUNCH: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    api.stderr.on('data', (chunk) => process.stderr.write(`[API STDERR] ${chunk}`));
    api.stdout.on('data', (chunk) => process.stdout.write(`[API STDOUT] ${chunk}`));
    childProcesses.push(api);

    const apiUrl = `http://127.0.0.1:${apiPort}`;
    await waitForHealth(apiUrl);

    // 1. Iniciar jornada e realizar login com cookie seguro e origem autorizada
    const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://gamberine.com.br',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ email: 'funcionario@empresa.com', password: 'senha', domain: 'empresa' }),
    });
    expect(loginRes.ok).toBe(true);
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(';')[0];

    // Salvar perfil de localizacao autorizado para permitir batida automatica
    const locRes = await fetch(`${apiUrl}/api/rhid/location-profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://gamberine.com.br',
        'X-Forwarded-Proto': 'https',
        Cookie: cookie,
      },
      body: JSON.stringify({
        home: { address: 'Rua Casa, 100', point: { latitude: -19.9328, longitude: -43.9387, accuracy: 10 } },
        work: { address: 'Avenida Trabalho, 200', point: { latitude: -19.9328, longitude: -43.9387, accuracy: 10 } },
        onsiteDates: [todayIso],
      }),
    });
    expect(locRes.ok).toBe(true);

    // 2. Definir estado inicial do dia: Entrada 1 (08:00) e Saida 1 (12:00)
    const tEntrada1 = new Date(`${todayIso}T08:00:00-03:00`).getTime();
    const tSaida1 = new Date(`${todayIso}T12:00:00-03:00`).getTime();
    mockPunches = [
      { dateTimeStr: `${todayPrefix}080000`, latitude: -19.9328, longitude: -43.9387 },
      { dateTimeStr: `${todayPrefix}120000`, latitude: -19.9328, longitude: -43.9387 },
    ];
    punchSubmissionCount = 0;

    // 3. CENARIO A - RETORNO DE ALMOCO COM NAVEGADOR FECHADO:
    // O cliente nao esta aberto. Nenhuma janela ou aba.
    // O servidor executa avaliacao de automacao no horario 12:58 (58 min apos saida 1)
    const t58 = tSaida1 + 58 * 60_000;
    const res58 = await fetch(`${apiUrl}/api/rhid/automation/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ now: t58 }),
    });
    expect(res58.ok).toBe(true);
    const data58 = await res58.json();
    expect(data58.evalResult.results[0].action).toBe('lunch_window_not_met');
    expect(mockPunches.length).toBe(2); // Nao deve bater com 58 min

    // Horario 12:59 (59 min apos saida 1): atinge a janela validada de retorno (59-120 min)
    const t59 = tSaida1 + 59 * 60_000;
    const res59 = await fetch(`${apiUrl}/api/rhid/automation/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ now: t59 }),
    });
    expect(res59.ok).toBe(true);
    const data59 = await res59.json();
    expect(data59.evalResult.results[0].action).toBe('lunch_return_executed');
    expect(mockPunches.length).toBe(3); // Entrada 2 adicionada pelo servidor!
    expect(punchSubmissionCount).toBe(1);

    // IDEMPOTENCIA ESTRITA DO RETORNO DE ALMOCO:
    // Rodar 50 vezes repetidas com navegador fechado
    for (let i = 0; i < 50; i += 1) {
      await fetch(`${apiUrl}/api/rhid/automation/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now: t59 + (i + 1) * 1000 }),
      });
    }
    // Permanece exatamente 3 marcacoes, nenhuma duplicidade
    expect(mockPunches.length).toBe(3);
    expect(punchSubmissionCount).toBe(1);

    // 4. CENARIO B - SEGUNDA SAIDA DE SEGURANCA COM NAVEGADOR FECHADO:
    // O retorno de almoco ocorreu as 13:00.
    // Manha: 12:00 - 08:00 = 4h (240 min).
    // Jornada total prevista: 8h (480 min). Faltam 4h a tarde.
    // Previsao de termino: 13:00 + 4h = 17:00.
    // Limite de seguranca (+ 1h45): 18:45.
    mockPunches[2] = { dateTimeStr: `${todayPrefix}130000`, latitude: -19.9328, longitude: -43.9387 };
    const tEntrada2 = new Date(`${todayIso}T13:00:00-03:00`).getTime();
    const tSafetyThreshold = new Date(`${todayIso}T18:45:00-03:00`).getTime();

    // Antes do limite (ex: 18:44): nao deve bater
    const resBeforeSafety = await fetch(`${apiUrl}/api/rhid/automation/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ now: tSafetyThreshold - 60_000 }),
    });
    expect(resBeforeSafety.ok).toBe(true);
    const dataBeforeSafety = await resBeforeSafety.json();
    expect(dataBeforeSafety.evalResult.results[0].action).toBe('safety_threshold_not_met');
    expect(mockPunches.length).toBe(3);

    // Atingindo o limite de seguranca (18:45): servidor dispara a Segunda Saida automaticamente
    const resSafety = await fetch(`${apiUrl}/api/rhid/automation/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ now: tSafetyThreshold }),
    });
    expect(resSafety.ok).toBe(true);
    const dataSafety = await resSafety.json();
    expect(dataSafety.evalResult.results[0].action).toBe('safety_exit_executed');
    expect(mockPunches.length).toBe(4); // Segunda saida registrada automaticamente!
    expect(punchSubmissionCount).toBe(2);

    // IDEMPOTENCIA ESTRITA DA SEGUNDA SAIDA:
    // Rodar 50 vezes repetidas com navegador fechado
    for (let i = 0; i < 50; i += 1) {
      await fetch(`${apiUrl}/api/rhid/automation/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now: tSafetyThreshold + (i + 1) * 1000 }),
      });
    }
    // Permanece exatamente com 4 batidas, nenhuma duplicidade
    expect(mockPunches.length).toBe(4);
    expect(punchSubmissionCount).toBe(2);

    // 5. ABERTURA POSTERIOR PELO USUARIO:
    // O usuario abre o Gamb RH ID pela primeira vez apos sair do trabalho.
    // O frontend consulta /api/rhid/daily e encontra o estado sincronizado com as 4 marcacoes completas.
    const clientDailyRes = await fetch(`${apiUrl}/api/rhid/daily`, {
      headers: { Cookie: cookie },
    });
    expect(clientDailyRes.ok).toBe(true);
    const dailyData = await clientDailyRes.json();
    expect(dailyData.data.retorno.afdt.length).toBe(4);

    // 6. OBSERVABILIDADE:
    // Consulta logs de automacao para auditoria
    const logsRes = await fetch(`${apiUrl}/api/rhid/automation/logs`, {
      headers: { Cookie: cookie },
    });
    expect(logsRes.ok).toBe(true);
    const { logs } = await logsRes.json();
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some((l) => l.rule === 'automatic_lunch_return' && l.status === 'success')).toBe(true);
    expect(logs.some((l) => l.rule === 'automatic_safety_exit' && l.status === 'success')).toBe(true);
  }, 45_000);
});
