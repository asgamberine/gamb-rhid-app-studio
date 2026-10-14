import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const root = resolve(process.cwd());
const dataDir = resolve(process.env.DATA_DIR ?? join(root, '.data'));
const accountPath = join(dataDir, 'rhid-cli-account.json');
const sessionPath = join(dataDir, 'rhid-cli-session.json');
const apiBase = new URL(process.env.RHID_API_BASE ?? `http://127.0.0.1:${Number(process.env.API_PORT ?? 8787)}`);
const origin = apiBase.origin;

const args = parseArgs(process.argv.slice(2));
const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

if (args.help === 'true' || args.help === true || args.h === 'true' || args.h === true) {
  console.log(`
Uso:
  npm run rhid:punch -- --email <email> --domain <dominio> --profile <work|home>

Opções:
  --email <email>           E-mail do RHiD.
  --domain <dominio>        Domínio/empresa.
  --password <senha>        Senha do RHiD.
  --profile <work|home>     Reusa o ponto salvo em Ajustes.
  --latitude <valor>        Latitude explícita.
  --longitude <valor>       Longitude explícita.
  --accuracy <valor>        Precisão em metros.
  --automatic               Envia como marcação automática.
  --remember-account        Grava e-mail/domínio em .data/rhid-cli-account.json.
  --help                    Mostra esta ajuda.
`);
  process.exit(0);
}

function parseArgs(argv) {
  const result = {
    automatic: false,
    rememberAccount: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current.startsWith('--')) {
      continue;
    }
    const [key, inlineValue] = current.slice(2).split('=', 2);
    const value = inlineValue ?? (next && !next.startsWith('--') ? next : 'true');
    if (inlineValue === undefined && next && !next.startsWith('--')) {
      index += 1;
    }
    result[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  result.automatic = String(result.automatic).toLowerCase() === 'true';
  result.rememberAccount = String(result.rememberAccount).toLowerCase() === 'true';
  return result;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  const content = await readFile(path, 'utf8');
  return JSON.parse(content);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function prompt(question, defaultValue = '') {
  if (!isInteractive) {
    return defaultValue;
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    input.question(question, (answer) => {
      input.close();
      const text = normalizeText(answer);
      resolve(text || defaultValue);
    });
  });
}

async function promptSecret(question) {
  if (!isInteractive) {
    return '';
  }
  process.stdout.write(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    let value = '';
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0008' || char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    function cleanup() {
      stdin.off('data', onData);
      if (stdin.isTTY) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
    }
    stdin.on('data', onData);
  });
}

async function apiRequest(path, options = {}, cookie = '') {
  const response = await fetch(new URL(path, apiBase), {
    ...options,
    headers: {
      Origin: origin,
      ...(options.headers ?? {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function cookieHeaderFromResponse(response) {
  const setCookie = response.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : '';
}

async function loadCachedSession() {
  if (!(await fileExists(sessionPath))) {
    return null;
  }
  try {
    const stored = await readJson(sessionPath);
    return typeof stored?.cookie === 'string' && stored.cookie ? stored : null;
  } catch {
    return null;
  }
}

async function loadSavedAccount() {
  if (!(await fileExists(accountPath))) {
    return null;
  }
  try {
    const stored = await readJson(accountPath);
    const email = normalizeText(stored?.email);
    const domain = normalizeText(stored?.domain);
    if (!email) {
      return null;
    }
    return { email, domain };
  } catch {
    return null;
  }
}

async function selectDomain(customers, currentDomain) {
  if (!Array.isArray(customers) || customers.length === 0) {
    return currentDomain;
  }
  if (customers.length === 1) {
    return normalizeText(customers[0]?.domain) || currentDomain;
  }
  if (!isInteractive) {
    return currentDomain;
  }
  console.log('Selecione a empresa vinculada à conta:');
  customers.forEach((customer, index) => {
    console.log(`  ${index + 1}. ${customer?.name ?? customer?.domain} (${customer?.domain})`);
  });
  const choice = Number(await prompt('Número da empresa: '));
  const selected = customers[Number.isInteger(choice) && choice > 0 ? choice - 1 : -1];
  return normalizeText(selected?.domain) || currentDomain;
}

async function authenticate(account, password) {
  const payload = {
    email: account.email,
    password,
    domain: account.domain ?? '',
  };
  const { response, payload: body } = await apiRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.status === 200 && body?.requiresDomain) {
    const nextDomain = await selectDomain(body.customers ?? [], account.domain);
    if (!nextDomain) {
      throw new Error('A conta exige seleção de empresa, mas nenhum domínio foi informado.');
    }
    return authenticate({ ...account, domain: nextDomain }, password);
  }

  if (!response.ok || !body?.authenticated) {
    throw new Error(body?.error ?? 'Falha no login do RHiD.');
  }

  const cookie = cookieHeaderFromResponse(response);
  if (cookie) {
    await mkdir(dirname(sessionPath), { recursive: true });
    await writeJson(sessionPath, {
      cookie,
      email: account.email,
      domain: account.domain ?? '',
      authenticatedAt: new Date().toISOString(),
    });
  }
  return body;
}

async function ensureAuthenticatedSession(account, passwordProvider) {
  const cached = await loadCachedSession();
  if (cached?.cookie) {
    const { response, payload } = await apiRequest('/api/auth/session', {}, cached.cookie);
    if (response.ok && payload?.authenticated) {
      return { cookie: cached.cookie, session: payload };
    }
  }

  const password = typeof passwordProvider === 'function'
    ? await passwordProvider()
    : passwordProvider;
  const session = await authenticate(account, password);
  const saved = await loadCachedSession();
  return { cookie: saved?.cookie ?? '', session };
}

async function resolveAccount() {
  const saved = await loadSavedAccount();
  const email = normalizeText(args.email ?? process.env.RHID_EMAIL ?? saved?.email);
  const domain = normalizeText(args.domain ?? process.env.RHID_DOMAIN ?? saved?.domain);
  if (email) {
    return { email, domain };
  }
  if (!isInteractive) {
    throw new Error('Informe --email e --domain, ou crie .data/rhid-cli-account.json.');
  }
  const nextEmail = await prompt('E-mail do RHiD: ');
  const nextDomain = await prompt('Domínio da empresa (opcional): ');
  if (!nextEmail) {
    throw new Error('E-mail não informado.');
  }
  return { email: nextEmail, domain: nextDomain };
}

async function resolvePassword() {
  const password = normalizeText(args.password ?? process.env.RHID_PASSWORD);
  if (password) {
    return password;
  }
  if (!isInteractive) {
    throw new Error('Informe --password ou RHID_PASSWORD.');
  }
  const nextPassword = await promptSecret('Senha do RHiD: ');
  if (!nextPassword) {
    throw new Error('Senha não informada.');
  }
  return nextPassword;
}

async function resolveLocation(cookie) {
  const latitude = normalizeNumber(args.latitude ?? process.env.RHID_LATITUDE);
  const longitude = normalizeNumber(args.longitude ?? process.env.RHID_LONGITUDE);
  const accuracySource = args.accuracy ?? process.env.RHID_ACCURACY;
  const accuracy = accuracySource === undefined || accuracySource === null || accuracySource === ''
    ? null
    : normalizeNumber(accuracySource);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return {
      latitude,
      longitude,
      accuracy,
      timestamp: Date.now(),
    };
  }

  const profileName = normalizeText(args.profile ?? process.env.RHID_PROFILE);
  if (profileName) {
    const { response, payload } = await apiRequest('/api/rhid/location-profile', {}, cookie);
    if (!response.ok) {
      throw new Error(payload?.error ?? 'Não foi possível consultar o perfil de localização.');
    }
    const profile = payload?.profile?.[profileName];
    const point = profile?.point;
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
      throw new Error(`O perfil "${profileName}" não possui ponto salvo válido.`);
    }
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: Number.isFinite(point.accuracy) ? point.accuracy : null,
      timestamp: Date.now(),
    };
  }

  if (!isInteractive) {
    throw new Error('Informe --latitude/--longitude ou --profile.');
  }
  const nextLatitude = normalizeNumber(await prompt('Latitude: '));
  const nextLongitude = normalizeNumber(await prompt('Longitude: '));
  const nextAccuracy = await prompt('Precisão (opcional, em metros): ');
  if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) {
    throw new Error('Latitude/longitude inválidas.');
  }
  return {
    latitude: nextLatitude,
    longitude: nextLongitude,
    accuracy: nextAccuracy ? normalizeNumber(nextAccuracy) : null,
    timestamp: Date.now(),
  };
}

async function main() {
  const account = await resolveAccount();
  const rememberAccount = args.rememberAccount || !isInteractive;

  const { cookie, session } = await ensureAuthenticatedSession(account, resolvePassword);
  if (!cookie) {
    throw new Error('Login concluído, mas o cookie de sessão não foi retornado pelo backend.');
  }

  if (args.saveAccount === 'true' || args.saveAccount === true || rememberAccount) {
    await writeJson(accountPath, {
      email: account.email,
      domain: account.domain ?? '',
      savedAt: new Date().toISOString(),
    });
  }

  const location = await resolveLocation(cookie);
  const { response: punchResponse, payload } = await apiRequest('/api/rhid/punch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...location,
      automatic: String(args.automatic).toLowerCase() === 'true',
    }),
  }, cookie);

  if (!punchResponse.ok) {
    throw new Error(payload?.error ?? 'Falha ao registrar o ponto.');
  }

  console.log(`Autenticado como ${session.displayName ?? account.email} (${account.email}).`);
  console.log(`Registro aceito em ${payload.acceptedAt ?? 'agora'}.`);
  if (payload.datetime) {
    console.log(`Horário confirmado pelo RHiD: ${payload.datetime}.`);
  }
  if (payload.hash) {
    console.log(`Hash: ${payload.hash}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
