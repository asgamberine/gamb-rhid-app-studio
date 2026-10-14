import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import {
  createFixedWindowLimiter,
  externalAccessConfig,
  isExternalAccessAuthorized,
  requestClientIp,
} from './externalAccess.mjs';
import {
  automaticLocationDecision,
  automaticLunchWindowDecision,
  automaticSafetyExitDecision,
  calculateSafetyExitThreshold,
  DEFAULT_TARGET_MINUTES,
  MINIMUM_PUNCH_INTERVAL_MS,
} from './punchPolicy.mjs';
import {
  isSuccessIndicator,
  remoteRequestError,
  remoteRequestWasConfirmed,
} from './rhidRequestConfirmation.mjs';
import { portalRequestListPayload } from './rhidRequestFlow.mjs';
import { isTrustedMutationRequest, trustedCorsOrigin } from './requestSecurity.mjs';
import { punchSubmissionAuthorization } from './punchSubmissionPolicy.mjs';
import { createPunchSubmissionCoordinator } from './punchSubmissionCoordinator.mjs';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookieHeader,
  sessionCookieHeader,
} from './sessionCookie.mjs';
import { normalizedSessionMaxAgeSeconds, sessionIsCurrent } from './sessionPolicy.mjs';
import { staticCacheControl } from './staticSecurity.mjs';

const managedProduction = process.env.NODE_ENV === 'production' && Boolean(process.env.PORT);
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const host = process.env.HOST ?? (managedProduction ? '0.0.0.0' : '127.0.0.1');
const rhidApiUrl = process.env.RHID_API_URL ?? 'https://www.rhid.com.br/v2/api.svc';
const rhidPortalUrl = process.env.RHID_PORTAL_URL ?? 'https://www.rhid.com.br/v2';
const rhidReppUrl = process.env.RHID_REPP_URL ?? 'https://repp.rhid.com.br';
const geocodingUrl = process.env.GEOCODING_URL ?? 'https://nominatim.openstreetmap.org/search';
const officialPunchEnabled = !['false', '0', 'no'].includes(
  String(process.env.ALLOW_OFFICIAL_RHID_PUNCH ?? 'true').toLowerCase(),
);
const minimumPunchIntervalMs = MINIMUM_PUNCH_INTERVAL_MS;
const completedJourneyLockMs = 4 * 60 * 60_000;
const minimumCompletedWorkMs = 8 * 60 * 60_000;
const requestConfirmationAttempts = 8;
const requestConfirmationIntervalMs = 1_000;
const officialHistoryFreezeEnd = '2026-06-30';
const sessionCookie = SESSION_COOKIE_NAME;
const maxSessionAgeSeconds = normalizedSessionMaxAgeSeconds(process.env.SESSION_MAX_AGE_SECONDS);
const dataDir = process.env.DATA_DIR ?? (managedProduction
  ? join(homedir(), '.local', 'share', 'gamb-rhid')
  : join(process.cwd(), '.data'));
const keyPath = join(dataDir, 'session.key');
const databasePath = join(dataDir, 'rhid.sqlite');
const publicBase = normalizeBasePath(process.env.PUBLIC_BASE ?? process.env.VITE_PUBLIC_BASE ?? '/gamb_rhid/');
const staticRoot = resolve(process.env.STATIC_DIR ?? join(process.cwd(), 'dist'));
const serveStaticSetting = String(process.env.SERVE_STATIC ?? '').toLowerCase();
const serveStaticEnabled = ['true', '1', 'yes'].includes(serveStaticSetting)
  || (serveStaticSetting === '' && process.env.NODE_ENV === 'production');
const trustProxySetting = String(process.env.TRUST_PROXY ?? '').toLowerCase();
const trustProxy = ['true', '1', 'yes'].includes(trustProxySetting)
  || (trustProxySetting === '' && managedProduction);
const externalAccess = externalAccessConfig();
const externalAccessLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 15 * 60_000 });
const rhidLoginLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 15 * 60_000 });
const sessionKey = await loadSessionKey();
const database = await openDatabase();
const recentPunchSubmissions = new Map();
const punchSubmissionCoordinator = createPunchSubmissionCoordinator();
let geocodeRequestQueue = Promise.resolve();
let lastGeocodeRequestAt = 0;
const staticMimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);
function normalizeBasePath(path) {
  const configured = String(path || '/').trim();
  if (configured === '/') {
    return '/';
  }
  const withLeadingSlash = configured.startsWith('/') ? configured : `/${configured}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

function isInsideStaticRoot(filePath) {
  const root = resolve(staticRoot);
  const target = resolve(filePath);
  return target === root || target.startsWith(`${root}${sep}`);
}

function isSecureRequest(request) {
  const configured = String(process.env.COOKIE_SECURE ?? '').toLowerCase();
  if (['true', '1', 'yes'].includes(configured)) {
    return true;
  }
  if (['false', '0', 'no'].includes(configured)) {
    return false;
  }

  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  if (forwardedProto === 'https' || request.socket?.encrypted) {
    return true;
  }

  const hostname = String(request.headers.host ?? '').split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(hostname);
  return process.env.NODE_ENV === 'production' && !localHost;
}

function applySecurityHeaders(request, response) {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "worker-src 'self'",
  ].join('; '));
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(self), microphone=(), payment=(), usb=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (isSecureRequest(request)) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function applyCorsHeaders(request, response) {
  const origin = trustedCorsOrigin(request);
  if (!origin) {
    return false;
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Vary', 'Origin');
  return true;
}

function externalAccessDenied(response, retryAfterSeconds = 0) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'WWW-Authenticate': 'Basic realm="Gamb RHiD Plus", charset="UTF-8"',
  };
  if (retryAfterSeconds > 0) {
    headers['Retry-After'] = String(retryAfterSeconds);
  }
  response.writeHead(retryAfterSeconds > 0 ? 429 : 401, headers);
  response.end(
    retryAfterSeconds > 0
      ? 'Muitas tentativas de acesso. Aguarde e tente novamente.'
      : 'Autenticacao de acesso externo obrigatoria.',
  );
}

function acceptsHtml(request) {
  return String(request.headers.accept ?? '').includes('text/html');
}

function staticRequestPath(pathname) {
  let staticPath = pathname;
  if (publicBase !== '/') {
    const baseWithoutTrailingSlash = publicBase.slice(0, -1);
    if (staticPath === '/' || staticPath === baseWithoutTrailingSlash) {
      return { redirect: publicBase };
    }
    if (!staticPath.startsWith(publicBase)) {
      return null;
    }
    staticPath = staticPath.slice(baseWithoutTrailingSlash.length);
  }

  try {
    const relativePath = decodeURIComponent(staticPath === '/' ? '/index.html' : staticPath).replace(/^\/+/, '');
    const filePath = resolve(staticRoot, relativePath);
    return isInsideStaticRoot(filePath) ? { filePath } : null;
  } catch {
    return null;
  }
}

function staticContentType(filePath) {
  return staticMimeTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

async function serveStatic(request, response, url) {
  if (!serveStaticEnabled || !['GET', 'HEAD'].includes(request.method ?? '') || url.pathname.startsWith('/api/')) {
    return false;
  }

  const target = staticRequestPath(url.pathname);
  if (!target) {
    return false;
  }
  if (target.redirect) {
    response.writeHead(302, { Location: target.redirect });
    response.end();
    return true;
  }

  let filePath = target.filePath;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
    }
  } catch {
    if (!acceptsHtml(request) || extname(filePath)) {
      return false;
    }
    filePath = resolve(staticRoot, 'index.html');
  }

  if (!isInsideStaticRoot(filePath)) {
    return false;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': staticContentType(filePath),
      'Cache-Control': staticCacheControl(filePath),
    });
    response.end(request.method === 'HEAD' ? undefined : content);
    return true;
  } catch {
    return false;
  }
}

async function loadSessionKey() {
  if (process.env.SESSION_SECRET) {
    const raw = process.env.SESSION_SECRET.trim();
    if (raw) {
      const decoded = Buffer.from(raw, 'base64url');
      if (decoded.length >= 32) {
        return decoded.subarray(0, 32);
      }
      return createHash('sha256').update(raw).digest();
    }
  }

  try {
    return await readFile(keyPath);
  } catch {
    const key = randomBytes(32);
    await mkdir(dirname(keyPath), { recursive: true });
    await writeFile(keyPath, key, { mode: 0o600 });
    return key;
  }
}

async function openDatabase() {
  await mkdir(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS official_archives (
      account_key TEXT PRIMARY KEY,
      id_person INTEGER NOT NULL,
      punches_json TEXT NOT NULL,
      pending_days_json TEXT NOT NULL,
      balance_days_json TEXT NOT NULL DEFAULT '[]',
      saved_at TEXT NOT NULL,
      data_ini TEXT NOT NULL,
      data_final TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS official_history_backups (
      account_key TEXT NOT NULL,
      id_person INTEGER NOT NULL,
      data_ini TEXT NOT NULL,
      data_final TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      PRIMARY KEY (account_key, data_ini, data_final, payload_hash)
    );
    CREATE TABLE IF NOT EXISTS official_history_freezes (
      account_key TEXT NOT NULL,
      id_person INTEGER NOT NULL,
      freeze_end TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      punches_json TEXT NOT NULL,
      pending_days_json TEXT NOT NULL,
      balance_days_json TEXT NOT NULL,
      frozen_at TEXT NOT NULL,
      PRIMARY KEY (account_key, freeze_end)
    );
    CREATE TRIGGER IF NOT EXISTS official_history_freezes_no_update
    BEFORE UPDATE ON official_history_freezes BEGIN SELECT RAISE(ABORT, 'Histórico congelado não pode ser alterado'); END;
    CREATE TRIGGER IF NOT EXISTS official_history_freezes_no_delete
    BEFORE DELETE ON official_history_freezes BEGIN SELECT RAISE(ABORT, 'Histórico congelado não pode ser excluído'); END;
    CREATE TABLE IF NOT EXISTS official_submissions (
      account_key TEXT PRIMARY KEY,
      accepted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS official_punch_locations (
      account_key TEXT NOT NULL,
      rhid_day TEXT NOT NULL,
      punch_index INTEGER NOT NULL,
      punch_timestamp TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      source TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      PRIMARY KEY (account_key, rhid_day, punch_index)
    );
    CREATE TABLE IF NOT EXISTS rhid_requests (
      request_id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      request_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      description TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS location_profiles (
      account_key TEXT PRIMARY KEY,
      home_json TEXT NOT NULL,
      work_json TEXT NOT NULL,
      onsite_dates_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS geocode_cache (
      address_key TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS active_sessions (
      account_key TEXT PRIMARY KEY,
      session_token TEXT NOT NULL,
      email TEXT NOT NULL,
      domain TEXT NOT NULL,
      worker_daily INTEGER NOT NULL DEFAULT 1,
      official_enabled INTEGER NOT NULL DEFAULT 1,
      target_minutes INTEGER NOT NULL DEFAULT 480,
      automatic_lunch_enabled INTEGER NOT NULL DEFAULT 1,
      automatic_safety_exit_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_executions (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      rhid_day TEXT NOT NULL,
      rule TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      punch_index INTEGER,
      details_json TEXT,
      executed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auto_exec_account_day_rule
      ON automation_executions(account_key, rhid_day, rule);
  `);
  const archiveColumns = new Set(db.prepare('PRAGMA table_info(official_archives)').all().map((column) => column.name));
  if (!archiveColumns.has('balance_days_json')) {
    db.exec(`ALTER TABLE official_archives ADD COLUMN balance_days_json TEXT NOT NULL DEFAULT '[]'`);
  }
  return db;
}

function json(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16_384) {
      throw new Error('Payload muito grande.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function getCookie(request, name) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(value.join('='));
    }
  }
  return undefined;
}

function encryptSession(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function decryptSession(token) {
  try {
    const data = Buffer.from(token, 'base64url');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const decipher = createDecipheriv('aes-256-gcm', sessionKey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    return undefined;
  }
}

function sessionFromRequest(request) {
  const token = getCookie(request, sessionCookie);
  if (!token) return undefined;
  const session = decryptSession(token);
  return sessionIsCurrent(session, maxSessionAgeSeconds) ? session : undefined;
}

function sessionHeader(request, value) {
  return sessionCookieHeader(value, {
    secure: isSecureRequest(request),
    maxAgeSeconds: maxSessionAgeSeconds,
  });
}

function clearSessionHeader(request) {
  return clearSessionCookieHeader({ secure: isSecureRequest(request) });
}

function upstreamAuthorizationError(request, response, session, resource) {
  const age = Date.now() - new Date(session.createdAt).getTime();
  if (Number.isFinite(age) && age < 5 * 60_000) {
    json(response, 403, {
      error: `Login aceito, mas o RHiD não autorizou a consulta de ${resource} para esta conta.`,
    });
    return;
  }
  json(
    response,
    401,
    { error: 'A sessão RHiD expirou. Faça login novamente.' },
    { 'Set-Cookie': clearSessionHeader(request) },
  );
}

async function requestRhid(path, options = {}) {
  return requestExternal(`${rhidApiUrl}${path}`, options);
}

async function requestExternal(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // The apuracao endpoint is documented as string and can legitimately return text.
  }
  return { response, body };
}

function upstreamNetworkErrorMessage(error) {
  if (!(error instanceof Error)) {
    return null;
  }
  const cause = error.cause && typeof error.cause === 'object' ? error.cause : null;
  const causeCode = typeof cause?.code === 'string' ? cause.code : '';
  if ([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(causeCode)) {
    return 'Falha na validacao TLS com o RHiD. Reinicie a aplicacao com acesso aos certificados do sistema.';
  }
  if ([
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
  ].includes(causeCode)) {
    return 'Sem conexão com a base RHiD.';
  }
  return error.message === 'fetch failed' && causeCode
    ? `Falha ao conectar com o RHiD (${causeCode}).`
    : null;
}

function claimsFromAccessToken(accessToken) {
  try {
    const payload = accessToken.split('.')[1];
    return payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : {};
  } catch {
    return {};
  }
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 160);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function resolveDisplayName(body, claims) {
  return firstNonEmptyString(
    body?.name,
    body?.nome,
    body?.personName,
    body?.employeeName,
    claims?.name,
    claims?.preferred_username,
    claims?.unique_name,
    claims?.given_name,
  );
}

async function requireSession(request, response) {
  const session = sessionFromRequest(request);
  if (!session?.accessToken) {
    json(
      response,
      401,
      { error: 'Sessão RHiD não autenticada.' },
      { 'Set-Cookie': clearSessionHeader(request) },
    );
    return undefined;
  }
  return session;
}

function portalHeaders(session) {
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  if (session.customerId) {
    headers['X-Cid-RHiD'] = String(session.customerId);
  }
  return headers;
}

function requestPortalDaily(session) {
  return requestExternal(`${rhidReppUrl}/ponto_diario`, {
    headers: portalHeaders(session),
  });
}

async function resolveSessionPersonId(session) {
  const persistedPersonId = validPersonId(session.personId);
  if (persistedPersonId) {
    return {
      ok: true,
      idPerson: persistedPersonId,
      session: session.personId === persistedPersonId ? session : { ...session, personId: persistedPersonId },
    };
  }

  const { response: dailyResponse, body: dailyBody } = await requestPortalDaily(session);
  if (dailyResponse.status === 401 || dailyResponse.status === 403) {
    return { ok: false, authFailed: true };
  }
  if (!dailyResponse.ok) {
    return { ok: false, lookupFailed: true };
  }

  const idPerson = validPersonId(dailyBody?.retorno?.idPerson);
  if (!idPerson) {
    return { ok: false, missingPerson: true };
  }

  return {
    ok: true,
    idPerson,
    session: { ...session, personId: idPerson },
  };
}

function requestPortalRequestsList(session, idPerson, startDate, endDate) {
  const payload = portalRequestListPayload(idPerson, startDate, endDate);
  if (!payload) {
    throw new Error('Período inválido para consultar solicitações no portal RHiD.');
  }
  return requestExternal(`${rhidPortalUrl}/report.svc/list_alteracoes_ponto`, {
    method: 'POST',
    headers: { ...portalHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function currentRhidDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).replaceAll('-', '');
}

function saoPauloDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function portalPunchesForToday(body) {
  const entries = body?.retorno?.afdt;
  if (!Array.isArray(entries)) {
    return [];
  }
  const today = currentRhidDate();
  return entries
    .filter((entry) => !isExcludedPortalPunch(entry))
    .filter((entry) => String(entry?.dateTimeStr ?? '').startsWith(today))
    .sort((left, right) => (portalPunchTimestamp(left) ?? 0) - (portalPunchTimestamp(right) ?? 0));
}

function portalPunchTimestamp(entry) {
  const match = String(entry?.dateTimeStr ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!match) {
    return null;
  }
  const [, year, month, date, hours, minutes, seconds = '00'] = match;
  const value = new Date(`${year}-${month}-${date}T${hours}:${minutes}:${seconds}-03:00`).getTime();
  return Number.isFinite(value) ? value : null;
}

function portalDateTimeStrToIso(value) {
  const match = typeof value === 'string'
    ? value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/)
    : null;
  if (!match) {
    return null;
  }
  const [, year, month, date, hours, minutes, seconds = '00'] = match;
  const timestamp = new Date(`${year}-${month}-${date}T${hours}:${minutes}:${seconds}-03:00`).toISOString();
  return Number.isNaN(Date.parse(timestamp)) ? null : timestamp;
}

function isExcludedPortalPunch(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  if (entry.excluido === true || entry.excluida === true || entry.excluded === true || entry.isExcluded === true) {
    return true;
  }
  if (String(entry.status ?? '').trim().toLowerCase() === 'excluido') {
    return true;
  }
  const typeRegister = String(entry._typeRegister ?? '').trim().toUpperCase();
  return typeRegister === 'O' && entry.idAfdChange != null;
}

function sessionPunchKey(session) {
  return `${String(session.email ?? '').toLowerCase()}:${String(session.domain ?? '').toLowerCase()}`;
}

function validCoordinatePoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const rawAccuracy = value.accuracy;
  const accuracy = rawAccuracy === null || rawAccuracy === undefined ? null : Number(rawAccuracy);
  if (
    !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    accuracy,
    capturedAt: typeof value.capturedAt === 'string' && !Number.isNaN(Date.parse(value.capturedAt))
      ? value.capturedAt
      : new Date().toISOString(),
  };
}

function validLocationPreset(value) {
  const address = typeof value?.address === 'string' ? value.address.trim().slice(0, 500) : '';
  const point = value?.point === null || value?.point === undefined
    ? null
    : validCoordinatePoint(value.point);
  if (value?.point && (!point || !address)) {
    return null;
  }
  return { address, point };
}

function validCalendarDate(value) {
  const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) {
    return false;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function validOnsiteDates(values) {
  if (!Array.isArray(values) || values.length > 366) {
    return null;
  }
  if (values.some((value) => !validCalendarDate(value))) {
    return null;
  }
  const dates = values.filter(validCalendarDate);
  return [...new Set(dates)].sort();
}

function emptyLocationProfile() {
  return {
    home: { address: '', point: null },
    work: { address: '', point: null },
    onsiteDates: [],
  };
}

function locationProfileForSession(session) {
  const row = database.prepare('SELECT * FROM location_profiles WHERE account_key = ?').get(sessionPunchKey(session));
  if (!row) {
    return emptyLocationProfile();
  }
  try {
    return {
      home: JSON.parse(String(row.home_json)),
      work: JSON.parse(String(row.work_json)),
      onsiteDates: JSON.parse(String(row.onsite_dates_json)),
      updatedAt: String(row.updated_at),
    };
  } catch {
    return emptyLocationProfile();
  }
}

function persistLocationProfile(session, profile) {
  const updatedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO location_profiles (account_key, home_json, work_json, onsite_dates_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_key) DO UPDATE SET
      home_json = excluded.home_json,
      work_json = excluded.work_json,
      onsite_dates_json = excluded.onsite_dates_json,
      updated_at = excluded.updated_at
  `).run(
    sessionPunchKey(session),
    JSON.stringify(profile.home),
    JSON.stringify(profile.work),
    JSON.stringify(profile.onsiteDates),
    updatedAt,
  );
  return { ...profile, updatedAt };
}

function portalEntryLocation(entry) {
  return validCoordinatePoint({
    latitude: entry?.latitude ?? entry?.position?.coords?.latitude,
    longitude: entry?.longitude ?? entry?.position?.coords?.longitude,
    accuracy: entry?.accuracy ?? entry?.position?.coords?.accuracy ?? null,
    capturedAt: entry?.dateTimeStr,
  });
}

function persistPunchLocation(session, day, punchIndex, point, source, punchTimestamp = null) {
  database.prepare(`
    INSERT INTO official_punch_locations (
      account_key, rhid_day, punch_index, punch_timestamp,
      latitude, longitude, accuracy, source, saved_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key, rhid_day, punch_index) DO UPDATE SET
      punch_timestamp = COALESCE(excluded.punch_timestamp, official_punch_locations.punch_timestamp),
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy = excluded.accuracy,
      source = excluded.source,
      saved_at = excluded.saved_at
  `).run(
    sessionPunchKey(session),
    day,
    punchIndex,
    punchTimestamp,
    point.latitude,
    point.longitude,
    point.accuracy,
    source,
    new Date().toISOString(),
  );
}

function persistPortalPunchLocations(session, entries) {
  entries.forEach((entry, index) => {
    const point = portalEntryLocation(entry);
    const timestamp = portalPunchTimestamp(entry);
    if (point && timestamp !== null) {
      persistPunchLocation(
        session,
        saoPauloDay(timestamp),
        index,
        point,
        'rhid-daily',
        new Date(timestamp).toISOString(),
      );
    }
  });
}

function storedPunchLocations(session, day) {
  return database.prepare(`
    SELECT punch_index, punch_timestamp, latitude, longitude, accuracy, source, saved_at
    FROM official_punch_locations
    WHERE account_key = ? AND rhid_day = ?
    ORDER BY punch_index
  `).all(sessionPunchKey(session), day).map((row) => ({
    punchIndex: Number(row.punch_index),
    punchTimestamp: row.punch_timestamp ? String(row.punch_timestamp) : null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    source: String(row.source),
    capturedAt: String(row.saved_at),
  }));
}

function automaticLocationReferences(session, day, dailyPunches) {
  const storedByIndex = new Map(storedPunchLocations(session, day).map((entry) => [entry.punchIndex, entry]));
  const candidateIndices = dailyPunches.length >= 3 ? [0, 1, 2] : [0, 1];
  const dailyReferences = candidateIndices
    .map((index) => portalEntryLocation(dailyPunches[index]) ?? storedByIndex.get(index) ?? null)
    .filter(Boolean);
  if (dailyReferences.length >= 2) {
    return {
      source: 'daily-punches',
      references: dailyReferences,
    };
  }

  const profile = locationProfileForSession(session);
  const onsite = profile.onsiteDates.includes(day);
  const preset = onsite ? profile.work : profile.home;
  return {
    source: onsite ? 'work-profile' : 'home-profile',
    references: preset?.point ? [preset.point] : (dailyReferences.length > 0 ? dailyReferences : []),
  };
}

function persistActiveSession(session, cookieToken) {
  if (!session?.email || !session.workerDaily) return;
  const key = sessionPunchKey(session);
  const nowIso = new Date().toISOString();
  database.prepare(`
    INSERT INTO active_sessions (
      account_key, session_token, email, domain, worker_daily, official_enabled,
      target_minutes, automatic_lunch_enabled, automatic_safety_exit_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key) DO UPDATE SET
      session_token = excluded.session_token,
      worker_daily = excluded.worker_daily,
      official_enabled = excluded.official_enabled,
      updated_at = excluded.updated_at
  `).run(
    key,
    cookieToken,
    String(session.email).toLowerCase(),
    String(session.domain ?? '').toLowerCase(),
    session.workerDaily ? 1 : 0,
    officialPunchEnabled ? 1 : 0,
    DEFAULT_TARGET_MINUTES,
    1,
    1,
    session.createdAt || nowIso,
    nowIso,
  );
}

function removeActiveSession(accountKey) {
  database.prepare('DELETE FROM active_sessions WHERE account_key = ?').run(accountKey);
}

function recordAutomationExecution({ accountKey, day, rule, status, reason = null, punchIndex = null, details = null }) {
  database.prepare(`
    INSERT INTO automation_executions (
      id, account_key, rhid_day, rule, status, reason, punch_index, details_json, executed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    accountKey,
    day,
    rule,
    status,
    reason,
    punchIndex,
    details ? JSON.stringify(details) : null,
    new Date().toISOString(),
  );
}

function hasSuccessfulAutomationToday(accountKey, day, rule) {
  const row = database.prepare(`
    SELECT id FROM automation_executions
    WHERE account_key = ? AND rhid_day = ? AND rule = ? AND status = 'success'
    LIMIT 1
  `).get(accountKey, day, rule);
  return Boolean(row);
}

function listAutomationLogs(accountKey, limit = 50) {
  return database.prepare(`
    SELECT id, account_key, rhid_day, rule, status, reason, punch_index, details_json, executed_at
    FROM automation_executions
    WHERE account_key = ?
    ORDER BY executed_at DESC
    LIMIT ?
  `).all(accountKey, limit).map((row) => ({
    id: row.id,
    accountKey: row.account_key,
    day: row.rhid_day,
    rule: row.rule,
    status: row.status,
    reason: row.reason,
    punchIndex: row.punch_index,
    details: row.details_json ? JSON.parse(row.details_json) : null,
    executedAt: row.executed_at,
  }));
}

async function executePortalPunch(session, point, { automatic = false, timestamp = Date.now() } = {}) {
  const coords = {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: Number.isFinite(point.accuracy) && point.accuracy >= 0 ? point.accuracy : null,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  };
  const payload = {
    position: {
      coords,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    },
    latitude: point.latitude.toFixed(10),
    longitude: point.longitude.toFixed(10),
  };
  const { response: rhidResponse, body } = await requestExternal(`${rhidReppUrl}/marcacao_web`, {
    method: 'POST',
    headers: { ...portalHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (rhidResponse.status === 401 || rhidResponse.status === 403) {
    return { ok: false, authExpired: true, error: 'Sessao RHID expirou.' };
  }
  if (!rhidResponse.ok || !body || typeof body !== 'object' || Number(body.status) === 0) {
    return {
      ok: false,
      authExpired: false,
      error: body?.error || 'O RHID nao confirmou a marcacao.',
    };
  }
  return {
    ok: true,
    authExpired: false,
    datetime: body.retorno?.datetime ?? new Date().toISOString(),
    hash: body.retorno?.hash ?? null,
  };
}

async function evaluateSessionAutomations(session, record, now = Date.now()) {
  const accountKey = sessionPunchKey(session);
  const day = saoPauloDay(now);

  const { response: dailyResponse, body: dailyBody } = await requestPortalDaily(session);
  if (dailyResponse.status === 401 || dailyResponse.status === 403) {
    removeActiveSession(accountKey);
    recordAutomationExecution({
      accountKey,
      day,
      rule: 'session_auth',
      status: 'failed',
      reason: 'UPSTREAM_AUTH_EXPIRED',
    });
    return { accountKey, action: 'auth_expired' };
  }
  if (!dailyResponse.ok) {
    return { accountKey, action: 'daily_fetch_failed' };
  }

  const dailyPunches = portalPunchesForToday(dailyBody);
  persistPortalPunchLocations(session, dailyPunches);

  const portalTimestamps = dailyPunches
    .map((entry) => portalPunchTimestamp(entry))
    .filter((timestamp) => timestamp !== null);

  const submissionKey = sessionPunchKey(session);
  const recentSubmission = Math.max(
    recentPunchSubmissions.get(submissionKey) ?? 0,
    persistedSubmissionAt(session) ?? 0,
  );
  const lastPunchAt = Math.max(recentSubmission ?? 0, ...portalTimestamps);
  const isCooldownActive = lastPunchAt > 0 && now < lastPunchAt + minimumPunchIntervalMs;

  // Caso A: Retorno de almoco (Entrada 2)
  if (dailyPunches.length === 2) {
    if (record.automatic_lunch_enabled === 0) {
      return { accountKey, action: 'lunch_disabled' };
    }
    if (hasSuccessfulAutomationToday(accountKey, day, 'automatic_lunch_return')) {
      return { accountKey, action: 'already_completed' };
    }

    const lunchExitAt = portalTimestamps[1];
    const lunchDecision = automaticLunchWindowDecision({ automatic: true, lunchExitAt, now });
    if (!lunchDecision.allowed) {
      return { accountKey, action: 'lunch_window_not_met', code: lunchDecision.code, retryAt: lunchDecision.retryAt };
    }

    if (isCooldownActive) {
      return { accountKey, action: 'cooldown_active', retryAt: lastPunchAt + minimumPunchIntervalMs };
    }

    const resolved = automaticLocationReferences(session, day, dailyPunches);
    const referencePoint = resolved.references[0];
    if (!referencePoint) {
      recordAutomationExecution({
        accountKey,
        day,
        rule: 'automatic_lunch_return',
        status: 'skipped',
        reason: 'AUTOMATIC_LOCATION_REFERENCE_MISSING',
      });
      return { accountKey, action: 'location_reference_missing' };
    }

    // Re-checar RHID ao vivo para prevenir concorrencia
    const preCheck = await requestPortalDaily(session);
    if (preCheck.response.ok) {
      const freshPunches = portalPunchesForToday(preCheck.body);
      if (freshPunches.length !== 2) {
        return { accountKey, action: 'punches_changed_before_execution', count: freshPunches.length };
      }
    }

    const punchResult = await executePortalPunch(session, referencePoint, { automatic: true, timestamp: now });
    if (punchResult.ok) {
      const acceptedValue = Number.isFinite(now) ? now : new Date(punchResult.datetime).getTime();
      recentPunchSubmissions.set(submissionKey, acceptedValue);
      persistSubmission(session, acceptedValue);
      persistPunchLocation(
        session,
        day,
        2,
        referencePoint,
        'automatic-server-lunch-return',
        punchResult.datetime,
      );
      recordAutomationExecution({
        accountKey,
        day,
        rule: 'automatic_lunch_return',
        status: 'success',
        punchIndex: 2,
        details: { hash: punchResult.hash, datetime: punchResult.datetime },
      });
      return { accountKey, action: 'lunch_return_executed', result: punchResult };
    }

    if (punchResult.authExpired) {
      removeActiveSession(accountKey);
      recordAutomationExecution({
        accountKey,
        day,
        rule: 'automatic_lunch_return',
        status: 'failed',
        reason: 'UPSTREAM_AUTH_EXPIRED',
      });
      return { accountKey, action: 'auth_expired' };
    }

    recordAutomationExecution({
      accountKey,
      day,
      rule: 'automatic_lunch_return',
      status: 'failed',
      reason: punchResult.error,
    });
    return { accountKey, action: 'punch_failed', error: punchResult.error };
  }

  // Caso B: Saida de seguranca (Saida 2)
  if (dailyPunches.length === 3) {
    if (record.automatic_safety_exit_enabled === 0) {
      return { accountKey, action: 'safety_exit_disabled' };
    }
    if (hasSuccessfulAutomationToday(accountKey, day, 'automatic_safety_exit')) {
      return { accountKey, action: 'already_completed' };
    }

    const targetMinutes = record.target_minutes || DEFAULT_TARGET_MINUTES;
    const safetyDecision = automaticSafetyExitDecision({
      punches: portalTimestamps,
      targetMinutes,
      now,
    });

    if (!safetyDecision.allowed) {
      return { accountKey, action: 'safety_threshold_not_met', code: safetyDecision.code, retryAt: safetyDecision.retryAt };
    }

    if (isCooldownActive) {
      return { accountKey, action: 'cooldown_active', retryAt: lastPunchAt + minimumPunchIntervalMs };
    }

    const resolved = automaticLocationReferences(session, day, dailyPunches);
    const referencePoint = resolved.references[0];
    if (!referencePoint) {
      recordAutomationExecution({
        accountKey,
        day,
        rule: 'automatic_safety_exit',
        status: 'skipped',
        reason: 'AUTOMATIC_LOCATION_REFERENCE_MISSING',
      });
      return { accountKey, action: 'location_reference_missing' };
    }

    // Re-checar RHID ao vivo para garantir que ainda sao 3 batidas
    const preCheck = await requestPortalDaily(session);
    if (preCheck.response.ok) {
      const freshPunches = portalPunchesForToday(preCheck.body);
      if (freshPunches.length !== 3) {
        return { accountKey, action: 'punches_changed_before_execution', count: freshPunches.length };
      }
    }

    const punchResult = await executePortalPunch(session, referencePoint, { automatic: true, timestamp: now });
    if (punchResult.ok) {
      const acceptedValue = Number.isFinite(now) ? now : new Date(punchResult.datetime).getTime();
      recentPunchSubmissions.set(submissionKey, acceptedValue);
      persistSubmission(session, acceptedValue);
      persistPunchLocation(
        session,
        day,
        3,
        referencePoint,
        'automatic-server-safety-exit',
        punchResult.datetime,
      );
      recordAutomationExecution({
        accountKey,
        day,
        rule: 'automatic_safety_exit',
        status: 'success',
        punchIndex: 3,
        details: {
          hash: punchResult.hash,
          datetime: punchResult.datetime,
          plannedFinishAt: safetyDecision.plannedFinishAt,
          safetyThresholdAt: safetyDecision.safetyThresholdAt,
        },
      });
      return { accountKey, action: 'safety_exit_executed', result: punchResult };
    }

    if (punchResult.authExpired) {
      removeActiveSession(accountKey);
      recordAutomationExecution({
        accountKey,
        day,
        rule: 'automatic_safety_exit',
        status: 'failed',
        reason: 'UPSTREAM_AUTH_EXPIRED',
      });
      return { accountKey, action: 'auth_expired' };
    }

    recordAutomationExecution({
      accountKey,
      day,
      rule: 'automatic_safety_exit',
      status: 'failed',
      reason: punchResult.error,
    });
    return { accountKey, action: 'punch_failed', error: punchResult.error };
  }

  return { accountKey, action: 'no_action_needed', count: dailyPunches.length };
}

export async function evaluateAutomations({ now = Date.now(), filterAccountKey = null } = {}) {
  if (!officialPunchEnabled) {
    return { results: [], disabled: true };
  }

  const rows = filterAccountKey
    ? database.prepare('SELECT * FROM active_sessions WHERE account_key = ? AND worker_daily = 1 AND official_enabled = 1').all(filterAccountKey)
    : database.prepare('SELECT * FROM active_sessions WHERE worker_daily = 1 AND official_enabled = 1').all();

  const results = [];
  for (const record of rows) {
    const accountKey = record.account_key;
    const session = decryptSession(record.session_token);
    if (!session || !sessionIsCurrent(session, maxSessionAgeSeconds, Date.now())) {
      removeActiveSession(accountKey);
      continue;
    }

    const submissionKey = sessionPunchKey(session);
    if (!punchSubmissionCoordinator.tryAcquire(submissionKey)) {
      results.push({ accountKey, action: 'submission_in_flight' });
      continue;
    }

    try {
      const res = await evaluateSessionAutomations(session, record, now);
      results.push(res);
    } catch (err) {
      console.error(`Erro ao avaliar automacao para ${accountKey}:`, err);
      results.push({ accountKey, action: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      punchSubmissionCoordinator.release(submissionKey);
    }
  }

  return { results };
}

let schedulerInterval = null;
export function startAutomationScheduler(intervalMs = 30_000) {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    evaluateAutomations().catch((err) => {
      console.error('Falha no ciclo do scheduler de automacao:', err);
    });
  }, intervalMs);
  schedulerInterval.unref();
}

export function stopAutomationScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

function collectNormalizedPunches(value, punches, excludedContext = false, requireOfficialId = false) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNormalizedPunches(entry, punches, excludedContext, requireOfficialId));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const rowExcluded = excludedContext || isExcludedPortalPunch(value);
  if (typeof value.dateTimeStr === 'string' && !rowExcluded && (!requireOfficialId || validPersonId(value.idAfd))) {
    const timestamp = portalDateTimeStrToIso(value.dateTimeStr);
    if (timestamp) {
      punches.set(timestamp, { id: `rhid:${timestamp}`, timestamp, origin: 'rhid' });
    }
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (key === 'dateTimeStr') {
      return;
    }
    collectNormalizedPunches(entry, punches, rowExcluded || /exclu/i.test(key), requireOfficialId);
  });
}

function collectNormalizedPunchArrays(value, punches) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNormalizedPunchArrays(entry, punches));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (Array.isArray(entry) && /^(?:list)?afdt(?:manutencao|excluidos?)?$/i.test(key)) {
      collectNormalizedPunches(entry, punches, /exclu/i.test(key), /manutencao/i.test(key));
      return;
    }
    collectNormalizedPunchArrays(entry, punches);
  });
}

function parsedPayload(value) {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizedPunches(value, directEntries = false) {
  const punches = new Map();
  const payload = parsedPayload(value);
  if (directEntries) {
    collectNormalizedPunches(payload, punches);
  } else {
    collectNormalizedPunchArrays(payload, punches);
  }
  return [...punches.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function collectPendingDays(value, pendingDays) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPendingDays(entry, pendingDays));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const pending = value.possuiPendencias === true || value.possuiPendencias === 1 || value.possuiPendencias === 'true';
  const match = String(value.dateTimeStr ?? value.date ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (pending && match) {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    pendingDays.set(date, { date, idPerson: validPersonId(value.idPerson) });
  }
  Object.values(value).forEach((entry) => collectPendingDays(entry, pendingDays));
}

function normalizedPendingDays(value) {
  const pendingDays = new Map();
  collectPendingDays(parsedPayload(value), pendingDays);
  return [...pendingDays.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function normalizedBalanceMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const match = trimmed.match(/^([+-])?(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] ?? '0');
  return sign * Math.round(hours * 60 + minutes + seconds / 60);
}

function officialBalanceMinutes(entry) {
  for (const key of ['saldoBancoFinalDia', 'saldoBancoAjustadoMaisCredDeb', 'saldoBancoHoras']) {
    const parsed = normalizedBalanceMinutes(entry?.[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function collectOfficialBalanceDays(value, balanceDays) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectOfficialBalanceDays(entry, balanceDays));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const match = String(value.dateTimeStr ?? value.date ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  const cumulativeBalanceMinutes = officialBalanceMinutes(value);
  if (match && cumulativeBalanceMinutes !== null) {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    balanceDays.set(date, { date, cumulativeBalanceMinutes });
  }
  Object.values(value).forEach((entry) => collectOfficialBalanceDays(entry, balanceDays));
}

function normalizedOfficialBalanceDays(value) {
  const balanceDays = new Map();
  collectOfficialBalanceDays(parsedPayload(value), balanceDays);
  return [...balanceDays.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function normalizedRequestDate(value, fallback = null) {
  const compact = compactPeriodDate(value);
  if (compact) {
    return compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8);
  }
  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString().slice(0, 10);
  }
  return fallback;
}

function normalizedRequestStatus(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['approved', 'aprovado', 'verde', 'v', '2'].includes(text)) {
    return 'approved';
  }
  if (['rejected', 'recusado', 'negado', 'x', '3'].includes(text)) {
    return 'rejected';
  }
  if (['queued', 'draft', 'local'].includes(text)) {
    return 'queued';
  }
  return 'pending';
}

function localRequestsForSession(session, startDate, endDate) {
  const rows = database.prepare(`
    SELECT *
    FROM rhid_requests
    WHERE account_key = ?
      AND end_date >= ?
      AND start_date <= ?
    ORDER BY created_at DESC
  `).all(sessionPunchKey(session), startDate, endDate);
  return rows.map((row) => ({
    id: String(row.request_id),
    type: String(row.request_type),
    status: normalizedRequestStatus(row.status),
    requestedAt: String(row.created_at).slice(0, 10),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    description: String(row.description),
    notes: row.notes ? String(row.notes) : undefined,
    filesUrl: [],
    source: 'local',
  }));
}

function persistLocalRequest(session, input, confirmation = {}) {
  const type = typeof input?.type === 'string' ? input.type.trim().slice(0, 80) : '';
  const description = typeof input?.description === 'string' ? input.description.trim().slice(0, 1_000) : '';
  const notes = typeof input?.notes === 'string' ? input.notes.trim().slice(0, 1_000) : '';
  const startDate = normalizedRequestDate(input?.startDate);
  const endDate = normalizedRequestDate(input?.endDate, startDate);
  if (!type || !description || !startDate || !endDate) {
    return null;
  }
  const request = {
    id: confirmation.id ? String(confirmation.id) : `local:${randomUUID()}`,
    type,
    status: confirmation.status ?? 'queued',
    requestedAt: new Date().toISOString().slice(0, 10),
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
    description,
    notes: notes || undefined,
    filesUrl: [],
    source: confirmation.source ?? 'local',
  };
  database.prepare(`
    INSERT INTO rhid_requests (
      request_id, account_key, request_type, start_date, end_date,
      description, notes, status, source, created_at, payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET
      request_type = excluded.request_type,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      description = excluded.description,
      notes = excluded.notes,
      status = excluded.status,
      source = excluded.source,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `).run(
    request.id,
    sessionPunchKey(session),
    request.type,
    request.startDate,
    request.endDate,
    request.description,
    request.notes ?? null,
    request.status,
    request.source,
    request.requestedAt,
    JSON.stringify({ ...request, accountKey: sessionPunchKey(session), remoteResponse: confirmation.remoteResponse ?? null }),
  );
  return request;
}

function deleteRetriedLocalRequest(session, requestId) {
  if (typeof requestId !== 'string' || !requestId.startsWith('local:')) return;
  database.prepare(`
    DELETE FROM rhid_requests
    WHERE request_id = ? AND account_key = ? AND source = 'local' AND status = 'queued'
  `).run(requestId, sessionPunchKey(session));
}

function normalizedRequestTypeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

const requestTypeAliases = {
  inclusao_marcacao: [
    'inclusao de marcacao',
    'inclusao marcacao',
    'inclusao de ponto',
    'inclusao ponto',
    'inclusao de batida',
    'inclusao batida',
    'inclusao manual',
    'inclusao',
    'esquecimento de marcacao',
    'esquecimento marcacao',
    'esquecimento de ponto',
    'esquecimento ponto',
    'esquecimento de batida',
    'esquecimento batida',
    'esquecimento',
    'marcacao ausente',
    'batida ausente',
    'falta de marcacao',
    'falta de batida',
    'marcacao nao efetuada',
    'batida nao efetuada',
    'batida nao registrada',
    'ajuste de marcacao',
    'ajuste marcacao',
    'ajuste de ponto',
    'ajuste ponto',
    'ajuste de batida',
    'ajuste batida',
    'marcacao manual',
    'batida manual',
    'marcacao',
    'batida',
    'ponto',
  ],
  atestado: ['atestado'],
  atestado_inss: ['atestado inss'],
  banco_horas: ['banco de horas', 'banco horas'],
  faltas: ['faltas', 'falta'],
  abono: ['abono'],
  ajuste_horas: ['ajuste de horas', 'ajuste horas'],
  relocar_extra_falta: ['relocar extra falta'],
};

function requestTypeRecords(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.records)) return body.records;
  return [];
}

function selectOfficialRequestType(body, requestedType) {
  const records = requestTypeRecords(body);
  const aliases = requestTypeAliases[requestedType] ?? [requestedType.replaceAll('_', ' ')];
  const normalizedAliases = aliases.map(normalizedRequestTypeName);

  // 1. Correspondência exata com algum alias
  for (const alias of normalizedAliases) {
    const exact = records.find((record) => {
      const candidate = normalizedRequestTypeName(record?.name ?? record?.description ?? record?.abreviation);
      return candidate === alias;
    });
    if (exact) return exact;
  }

  // 2. O candidato do RHiD contém o alias
  for (const alias of normalizedAliases) {
    const partial = records.find((record) => {
      const candidate = normalizedRequestTypeName(record?.name ?? record?.description ?? record?.abreviation);
      return candidate && candidate.includes(alias);
    });
    if (partial) return partial;
  }

  // 3. O alias contém o candidato do RHiD (se o candidato tiver pelo menos 4 caracteres)
  for (const alias of normalizedAliases) {
    const inverse = records.find((record) => {
      const candidate = normalizedRequestTypeName(record?.name ?? record?.description ?? record?.abreviation);
      return candidate && candidate.length >= 4 && alias.includes(candidate);
    });
    if (inverse) return inverse;
  }

  // 4. Fallback contextual para inclusao_marcacao
  if (requestedType === 'inclusao_marcacao') {
    const fallback = records.find((record) => {
      const candidate = normalizedRequestTypeName(record?.name ?? record?.description ?? record?.abreviation);
      return candidate.includes('inclus') || candidate.includes('esquec') || candidate.includes('marc') || candidate.includes('ponto') || candidate.includes('batid');
    });
    if (fallback) return fallback;
  }

  return null;
}

function compactRequestDateTime(date, time, fallbackTime) {
  return `${date.replaceAll('-', '')}${String(time || fallbackTime).replace(':', '').slice(0, 4)}`;
}

function officialRequestPayload(session, input, requestType) {
  const time = /^\d{2}:\d{2}$/.test(input.time ?? '') ? input.time : null;
  const startTime = time ?? '00:00';
  const endTime = time ?? '23:59';
  return {
    diurna_noturna: 'diurna',
    idPerson: Number(session.personId),
    name: session.displayName ?? session.email,
    idJustificationType: Number(requestType.id),
    justificationtypetype: Number(requestType.type ?? 1),
    mostrarMotivo: Number(requestType.mostrarMotivo ?? 1),
    informarCid: Boolean(requestType.informarCid),
    justificativa: String(requestType.name ?? input.description),
    motivo: input.notes ?? input.description,
    iniDataJustificativa: `${input.startDate}T00:00:00`,
    fimDataJustificativa: `${input.endDate}T00:00:00`,
    iniHoraJustificativa: startTime,
    fimHoraJustificativa: endTime,
    inicioStr: compactRequestDateTime(input.startDate, startTime, '00:00'),
    fimStr: compactRequestDateTime(input.endDate, endTime, '23:59'),
    minutesDiurno: 0,
    minutesNoturno: 0,
    files: [],
  };
}


function archiveForSession(session) {
  const accountKey = sessionPunchKey(session);
  const row = database.prepare('SELECT * FROM official_archives WHERE account_key = ?').get(accountKey);
  if (!row) {
    return null;
  }
  const frozenRow = database.prepare(`
    SELECT * FROM official_history_freezes
    WHERE account_key = ? AND freeze_end = ?
  `).get(accountKey, officialHistoryFreezeEnd);
  const currentPunches = JSON.parse(String(row.punches_json));
  const currentPendingDays = JSON.parse(String(row.pending_days_json));
  const currentBalanceDays = JSON.parse(String(row.balance_days_json ?? '[]'));
  const frozenPunches = frozenRow ? JSON.parse(String(frozenRow.punches_json)) : [];
  const frozenPendingDays = frozenRow ? JSON.parse(String(frozenRow.pending_days_json)) : [];
  const frozenBalanceDays = frozenRow ? JSON.parse(String(frozenRow.balance_days_json)) : [];
  return {
    idPerson: Number(row.id_person),
    punches: [...frozenPunches, ...currentPunches.filter((punch) => saoPauloDay(punch.timestamp) > officialHistoryFreezeEnd)],
    pendingDays: [...frozenPendingDays, ...currentPendingDays.filter((day) => day.date > officialHistoryFreezeEnd)],
    officialBalanceDays: [...frozenBalanceDays, ...currentBalanceDays.filter((day) => day.date > officialHistoryFreezeEnd)],
    savedAt: String(row.saved_at),
    dataIni: String(row.data_ini),
    dataFinal: String(row.data_final),
  };
}

function persistOfficialPeriod(session, idPerson, punches, pendingDays, officialBalanceDays, dataIni, dataFinal, savedAt) {
  if (!idPerson) {
    return;
  }
  const current = archiveForSession(session);
  const currentPunchesInPeriod = (current?.punches ?? []).filter((punch) => {
    const date = saoPauloDay(punch.timestamp);
    return date > officialHistoryFreezeEnd && date >= dataIni && date <= dataFinal;
  });
  const mutableIncomingPunches = punches.filter((punch) => saoPauloDay(punch.timestamp) > officialHistoryFreezeEnd);
  const protectedPunches = mutableIncomingPunches.length === 0 && currentPunchesInPeriod.length > 0
    ? currentPunchesInPeriod
    : mutableIncomingPunches;
  const retainedPunches = (current?.punches ?? []).filter((punch) => {
    const date = saoPauloDay(punch.timestamp);
    return date <= officialHistoryFreezeEnd || date < dataIni || date > dataFinal;
  });
  const uniquePunches = new Map([...retainedPunches, ...protectedPunches].map((punch) => [punch.id, punch]));
  const mutablePendingDays = (pendingDays ?? []).filter((day) => day.date > officialHistoryFreezeEnd);
  const retainedPendingDays = pendingDays === null
    ? current?.pendingDays ?? []
    : (current?.pendingDays ?? []).filter((day) => day.date <= officialHistoryFreezeEnd || day.date < dataIni || day.date > dataFinal);
  const uniquePendingDays = new Map([...retainedPendingDays, ...mutablePendingDays].map((day) => [day.date, day]));
  const mutableBalanceDays = (officialBalanceDays ?? []).filter((day) => day.date > officialHistoryFreezeEnd);
  const retainedBalanceDays = officialBalanceDays === null
    ? current?.officialBalanceDays ?? []
    : (current?.officialBalanceDays ?? []).filter((day) => day.date <= officialHistoryFreezeEnd || day.date < dataIni || day.date > dataFinal);
  const uniqueBalanceDays = new Map([...retainedBalanceDays, ...mutableBalanceDays].map((day) => [day.date, day]));
  const archive = {
    idPerson,
    punches: [...uniquePunches.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    pendingDays: [...uniquePendingDays.values()].sort((left, right) => right.date.localeCompare(left.date)),
    officialBalanceDays: [...uniqueBalanceDays.values()].sort((left, right) => left.date.localeCompare(right.date)),
    savedAt,
    dataIni: current?.dataIni && current.dataIni < dataIni ? current.dataIni : dataIni,
    dataFinal: current?.dataFinal && current.dataFinal > dataFinal ? current.dataFinal : dataFinal,
  };
  database.prepare(`
    INSERT INTO official_archives (account_key, id_person, punches_json, pending_days_json, balance_days_json, saved_at, data_ini, data_final)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key) DO UPDATE SET
      id_person = excluded.id_person,
      punches_json = excluded.punches_json,
      pending_days_json = excluded.pending_days_json,
      balance_days_json = excluded.balance_days_json,
      saved_at = excluded.saved_at,
      data_ini = excluded.data_ini,
      data_final = excluded.data_final
  `).run(
    sessionPunchKey(session),
    archive.idPerson,
    JSON.stringify(archive.punches),
    JSON.stringify(archive.pendingDays),
    JSON.stringify(archive.officialBalanceDays),
    archive.savedAt,
    archive.dataIni,
    archive.dataFinal,
  );
}

function persistOfficialHistoryBackup(session, idPerson, dataIni, dataFinal, payload, savedAt) {
  const payloadJson = JSON.stringify(payload);
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
  database.prepare(`
    INSERT OR IGNORE INTO official_history_backups (
      account_key, id_person, data_ini, data_final, payload_hash, payload_json, saved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionPunchKey(session), idPerson, dataIni, dataFinal, payloadHash, payloadJson, savedAt);
}

function completedJourneyRetryAt(timestamps) {
  const marks = timestamps.filter((value) => Number.isFinite(value)).sort((left, right) => left - right).slice(0, 4);
  if (marks.length < 4) {
    return null;
  }
  const workedMs = (marks[1] - marks[0]) + (marks[3] - marks[2]);
  return workedMs >= minimumCompletedWorkMs ? marks[3] + completedJourneyLockMs : null;
}

function persistedSubmissionAt(session) {
  const row = database.prepare('SELECT accepted_at FROM official_submissions WHERE account_key = ?').get(sessionPunchKey(session));
  return row ? Number(row.accepted_at) : null;
}

function persistSubmission(session, acceptedAt) {
  database.prepare(`
    INSERT INTO official_submissions (account_key, accepted_at)
    VALUES (?, ?)
    ON CONFLICT(account_key) DO UPDATE SET accepted_at = excluded.accepted_at
  `).run(sessionPunchKey(session), acceptedAt);
}

function validPersonId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function compactPeriodDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value.replaceAll('-', '') : null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const clientIp = requestClientIp(request, trustProxy);

  try {
    applySecurityHeaders(request, response);
    const corsAllowed = applyCorsHeaders(request, response);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      if (!corsAllowed) {
        json(response, 403, { error: 'Origem da requisição não autorizada.' });
        return;
      }
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
        'Access-Control-Max-Age': '600',
      });
      response.end();
      return;
    }

    if (externalAccess && !isExternalAccessAuthorized(request, externalAccess)) {
      const attempt = externalAccessLimiter.check(clientIp);
      externalAccessDenied(response, attempt.allowed ? 0 : attempt.retryAfterSeconds);
      return;
    }
    externalAccessLimiter.reset(clientIp);

    const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(clientIp);
    const internalToken = request.headers['x-automation-secret'] || url.searchParams.get('secret');
    const isAuthorizedInternalAutomation = url.pathname === '/api/rhid/automation/evaluate' && (
      (Boolean(process.env.AUTOMATION_SECRET) && internalToken === process.env.AUTOMATION_SECRET) || isLoopback
    );

    if (url.pathname.startsWith('/api/') && !isAuthorizedInternalAutomation && !isTrustedMutationRequest(request)) {
      json(response, 403, { error: 'Origem da requisição não autorizada.' });
      return;
    }


    if (request.method === 'GET' && url.pathname === '/api/health') {
      json(response, 200, { ok: true, externalAccessProtected: Boolean(externalAccess) });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      const session = sessionFromRequest(request);
      if (!session?.accessToken) {
        json(
          response,
          401,
          { authenticated: false },
          { 'Set-Cookie': clearSessionHeader(request) },
        );
        return;
      }
      if (session.source !== 'portal') {
        json(
          response,
          401,
          { authenticated: false, error: 'Entre novamente para ativar a consulta pelo portal RHiD.' },
          { 'Set-Cookie': clearSessionHeader(request) },
        );
        return;
      }
      json(response, 200, {
        authenticated: true,
        email: session.email,
        displayName: session.displayName,
        domain: session.domain ?? '',
        isPerson: session.isPerson ?? false,
        personId: session.personId ?? null,
        source: session.source ?? 'integration',
        workerDaily: session.workerDaily ?? false,
        officialPunchEnabled,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const loginAttempt = rhidLoginLimiter.check(clientIp);
      if (!loginAttempt.allowed) {
        json(
          response,
          429,
          { error: 'Muitas tentativas de login. Aguarde e tente novamente.' },
          { 'Retry-After': String(loginAttempt.retryAfterSeconds) },
        );
        return;
      }
      const { email, password, domain = '' } = await readJson(request);
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        json(response, 400, { error: 'Informe usuário e senha.' });
        return;
      }

      const { response: rhidResponse, body } = await requestExternal(`${rhidPortalUrl}/login.svc/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, domain: String(domain).trim() }),
      });

      const accessToken = body && typeof body === 'object' ? body.accessToken : undefined;
      const customers = Array.isArray(body.listCustomer)
        ? body.listCustomer
            .filter((customer) => customer && typeof customer.domain === 'string')
            .map((customer) => ({ id: customer.id, domain: customer.domain, name: customer.name ?? customer.domain }))
        : [];
      if (!accessToken && !String(domain).trim() && customers.length > 0) {
        json(response, 200, {
          authenticated: false,
          email: email.trim(),
          domain: '',
          requiresDomain: true,
          customers,
        }, { 'Set-Cookie': clearSessionHeader(request) });
        return;
      }
      if (!rhidResponse.ok || !accessToken) {
        json(response, 401, {
          error: body?.error || 'Login não autorizado pelo RHiD.',
          customers,
        });
        return;
      }

      const claims = claimsFromAccessToken(accessToken);
      const displayName = resolveDisplayName(body, claims);
      const workerDaily = String(claims.accessType) === '1';
      const personId = validPersonId(body.newID);
      const isPerson = workerDaily || Boolean(body.isPerson);
      const cookie = encryptSession({
        accessToken,
        email: email.trim(),
        displayName,
        domain: String(domain).trim(),
        isPerson,
        personId,
        source: 'portal',
        workerDaily,
        customerId: claims.cidCustomerId ?? null,
        createdAt: new Date().toISOString(),
      });
      rhidLoginLimiter.reset(clientIp);
      persistActiveSession({
        accessToken,
        email: email.trim(),
        displayName,
        domain: String(domain).trim(),
        isPerson,
        personId,
        source: 'portal',
        workerDaily,
        customerId: claims.cidCustomerId ?? null,
        createdAt: new Date().toISOString(),
      }, cookie);
      json(
        response,
        200,
        { authenticated: true, email: email.trim(), displayName, domain: String(domain).trim(), isPerson, personId, source: 'portal', workerDaily, officialPunchEnabled, customers },
        { 'Set-Cookie': sessionHeader(request, cookie) },
      );
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      const session = sessionFromRequest(request);
      if (session) {
        removeActiveSession(sessionPunchKey(session));
      }
      json(response, 200, { authenticated: false }, { 'Set-Cookie': clearSessionHeader(request) });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/archive') {
      const session = await requireSession(request, response);
      if (!session) return;
      json(response, 200, { archive: archiveForSession(session) });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/location-profile') {
      const session = await requireSession(request, response);
      if (!session) return;
      json(response, 200, { profile: locationProfileForSession(session) });
      return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/rhid/location-profile') {
      const session = await requireSession(request, response);
      if (!session) return;
      const input = await readJson(request);
      const home = validLocationPreset(input.home);
      const work = validLocationPreset(input.work);
      const onsiteDates = validOnsiteDates(input.onsiteDates);
      if (!home || !work || !onsiteDates) {
        json(response, 400, {
          error: 'Revise os locais cadastrados. Não foi possível validar um dos endereços, coordenadas ou datas informados.',
        });
        return;
      }
      json(response, 200, {
        profile: persistLocationProfile(session, { home, work, onsiteDates }),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/rhid/geocode') {
      const session = await requireSession(request, response);
      if (!session) return;
      const input = await readJson(request);
      const address = typeof input.address === 'string' ? input.address.trim().slice(0, 500) : '';
      if (address.length < 5) {
        json(response, 400, { error: 'Informe um endereço completo para converter em coordenadas.' });
        return;
      }
      const addressKey = address.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
      const cached = database.prepare('SELECT result_json FROM geocode_cache WHERE address_key = ?').get(addressKey);
      if (cached) {
        try {
          json(response, 200, JSON.parse(String(cached.result_json)));
          return;
        } catch {
          database.prepare('DELETE FROM geocode_cache WHERE address_key = ?').run(addressKey);
        }
      }
      const query = new URLSearchParams({
        q: address,
        format: 'jsonv2',
        limit: '1',
        countrycodes: 'br',
      });
      try {
        const scheduledRequest = geocodeRequestQueue.then(async () => {
          const waitMs = Math.max(1_000 - (Date.now() - lastGeocodeRequestAt), 0);
          if (waitMs > 0) {
            await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
          }
          lastGeocodeRequestAt = Date.now();
          return fetch(`${geocodingUrl}?${query}`, {
            headers: {
              Accept: 'application/json',
              'Accept-Language': 'pt-BR,pt;q=0.9',
              'User-Agent': 'gamb-rhid/0.1 (local TCE-MG attendance application)',
            },
            signal: AbortSignal.timeout(15_000),
          });
        });
        geocodeRequestQueue = scheduledRequest.then(() => undefined, () => undefined);
        const geocodeResponse = await scheduledRequest;
        if (!geocodeResponse.ok) {
          throw new Error(`Serviço de localização respondeu ${geocodeResponse.status}.`);
        }
        const results = await geocodeResponse.json();
        const match = Array.isArray(results) ? results[0] : null;
        const point = validCoordinatePoint({
          latitude: match?.lat,
          longitude: match?.lon,
          accuracy: null,
          capturedAt: new Date().toISOString(),
        });
        if (!point) {
          json(response, 404, { error: 'Endereço não localizado. Inclua número, bairro, cidade e estado.' });
          return;
        }
        const result = {
          point,
          displayName: String(match.display_name ?? address).slice(0, 500),
          attribution: '© OpenStreetMap contributors',
        };
        database.prepare(`
          INSERT INTO geocode_cache (address_key, result_json, saved_at)
          VALUES (?, ?, ?)
          ON CONFLICT(address_key) DO UPDATE SET result_json = excluded.result_json, saved_at = excluded.saved_at
        `).run(addressKey, JSON.stringify(result), new Date().toISOString());
        json(response, 200, result);
      } catch (error) {
        json(response, 502, {
          error: error instanceof Error
            ? `Não foi possível converter o endereço agora: ${error.message}`
            : 'Não foi possível converter o endereço agora.',
        });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/people') {
      const session = await requireSession(request, response);
      if (!session) return;
      const start = encodeURIComponent(url.searchParams.get('start') ?? '0');
      const length = encodeURIComponent(url.searchParams.get('length') ?? '100');
      const { response: rhidResponse, body } = await requestRhid(`/person?start=${start}&length=${length}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!rhidResponse.ok) {
        if (rhidResponse.status === 401) {
          upstreamAuthorizationError(request, response, session, 'funcionários');
          return;
        }
        json(response, 502, { error: 'Não foi possível consultar funcionários no RHiD.' });
        return;
      }
      json(response, 200, body);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/apuracao') {
      const session = await requireSession(request, response);
      if (!session) return;
      const dataIni = url.searchParams.get('dataIni');
      const dataFinal = url.searchParams.get('dataFinal');
      const idPerson = url.searchParams.get('idPerson');
      if (!dataIni || !dataFinal || !idPerson || !/^\d+$/.test(idPerson)) {
        json(response, 400, { error: 'Informe período e funcionário para consultar a apuração.' });
        return;
      }
      const query = new URLSearchParams({ dataIni, dataFinal, idPerson });
      const { response: rhidResponse, body } = await requestRhid(`/apuracao_ponto?${query}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!rhidResponse.ok) {
        if (rhidResponse.status === 401) {
          upstreamAuthorizationError(request, response, session, 'apuração de ponto');
          return;
        }
        json(response, 502, { error: 'Não foi possível consultar a apuração no RHiD.' });
        return;
      }
      json(response, 200, { data: body, syncedAt: new Date().toISOString(), idPerson: Number(idPerson), dataIni, dataFinal });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/daily') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (!session.workerDaily) {
        json(response, 403, { error: 'A sessão atual não é uma sessão de funcionário do portal RHiD.' });
        return;
      }
      const { response: rhidResponse, body } = await requestPortalDaily(session);
      if (!rhidResponse.ok) {
        if (rhidResponse.status === 401 || rhidResponse.status === 403) {
          upstreamAuthorizationError(request, response, session, 'marcações diárias');
          return;
        }
        json(response, 502, { error: 'Não foi possível consultar as marcações diárias no portal RHiD.' });
        return;
      }
      const syncedAt = new Date().toISOString();
      const idPerson = validPersonId(session.personId) ?? validPersonId(body?.retorno?.idPerson);
      const today = currentRhidDate().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      persistPortalPunchLocations(session, portalPunchesForToday(body));
      persistOfficialPeriod(
        session,
        idPerson,
        normalizedPunches(body?.retorno?.afdt ?? [], true),
        null,
        null,
        today,
        today,
        syncedAt,
      );
      json(response, 200, {
        data: body,
        syncedAt,
        idPerson,
        source: 'portal-daily',
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/history') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (!session.workerDaily) {
        json(response, 403, { error: 'A sessão atual não é uma sessão de funcionário do portal RHiD.' });
        return;
      }
      const dataIni = url.searchParams.get('dataIni');
      const dataFinal = url.searchParams.get('dataFinal');
      const ini = compactPeriodDate(dataIni);
      const fim = compactPeriodDate(dataFinal);
      if (!ini || !fim || ini > fim) {
        json(response, 400, { error: 'Informe um período válido para consultar o histórico.' });
        return;
      }

      let idPerson = validPersonId(session.personId);
      if (!idPerson) {
        const { response: dailyResponse, body: dailyBody } = await requestPortalDaily(session);
        if (dailyResponse.status === 401 || dailyResponse.status === 403) {
          upstreamAuthorizationError(request, response, session, 'marcações diárias');
          return;
        }
        if (!dailyResponse.ok) {
          json(response, 502, { error: 'Não foi possível identificar o funcionário para consultar o histórico.' });
          return;
        }
        idPerson = validPersonId(dailyBody?.retorno?.idPerson);
      }
      if (!idPerson) {
        json(response, 502, { error: 'O portal RHiD não informou o funcionário da sessão.' });
        return;
      }

      const { response: rhidResponse, body } = await requestExternal(
        `${rhidPortalUrl}/report.svc/apuracao_ponto_salva_tabela`,
        {
          method: 'POST',
          headers: { ...portalHeaders(session), 'Content-Type': 'application/json' },
          body: JSON.stringify({ idPerson: [idPerson], ini, fim, afdChanges: [] }),
        },
      );
      if (rhidResponse.status === 401 || rhidResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'histórico de ponto');
        return;
      }
      if (!rhidResponse.ok) {
        json(response, 502, { error: 'Não foi possível consultar o histórico de ponto no portal RHiD.' });
        return;
      }
      const syncedAt = new Date().toISOString();
      persistOfficialHistoryBackup(session, idPerson, dataIni, dataFinal, body, syncedAt);
      persistOfficialPeriod(
        session,
        idPerson,
        normalizedPunches(body),
        normalizedPendingDays(body),
        normalizedOfficialBalanceDays(body),
        dataIni,
        dataFinal,
        syncedAt,
      );
      json(response, 200, {
        data: body,
        syncedAt,
        idPerson,
        dataIni,
        dataFinal,
        source: 'portal-history',
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/pending') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (!session.workerDaily) {
        json(response, 403, { error: 'A sessão atual não é uma sessão de funcionário do portal RHiD.' });
        return;
      }
      const date = url.searchParams.get('date');
      const compactDate = compactPeriodDate(date);
      if (!compactDate) {
        json(response, 400, { error: 'Informe a data válida da pendência.' });
        return;
      }

      let idPerson = validPersonId(session.personId);
      if (!idPerson) {
        const { response: dailyResponse, body: dailyBody } = await requestPortalDaily(session);
        if (dailyResponse.status === 401 || dailyResponse.status === 403) {
          upstreamAuthorizationError(request, response, session, 'marcações diárias');
          return;
        }
        if (!dailyResponse.ok) {
          json(response, 502, { error: 'Não foi possível identificar o funcionário para consultar as pendências.' });
          return;
        }
        idPerson = validPersonId(dailyBody?.retorno?.idPerson);
      }
      if (!idPerson) {
        json(response, 502, { error: 'O portal RHiD não informou o funcionário da sessão.' });
        return;
      }

      const { response: rhidResponse, body } = await requestExternal(
        `${rhidPortalUrl}/report.svc/list_alteracoes_ponto`,
        {
          method: 'POST',
          headers: { ...portalHeaders(session), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalStatus: [1],
            departments: [],
            companies: [],
            people: [idPerson],
            ini: compactDate,
            fim: compactDate,
            insertedIni: '',
            insertedFim: '',
            classification: 'any',
            pendenciesOnly: false,
          }),
        },
      );
      if (rhidResponse.status === 401 || rhidResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'pendências de aprovação');
        return;
      }
      if (!rhidResponse.ok) {
        json(response, 502, { error: 'Não foi possível consultar as pendências no portal RHiD.' });
        return;
      }
      json(response, 200, {
        data: body,
        syncedAt: new Date().toISOString(),
        idPerson,
        date,
        source: 'portal-pending',
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/requests') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (!session.workerDaily) {
        json(response, 403, { error: 'A sessão atual não é uma sessão de funcionário do portal RHiD.' });
        return;
      }
      const startDate = compactPeriodDate(url.searchParams.get('startDate'));
      const endDate = compactPeriodDate(url.searchParams.get('endDate'));
      if (!startDate || !endDate || startDate > endDate) {
        json(response, 400, { error: 'Informe um período válido para consultar as solicitações.' });
        return;
      }

      const personResolution = await resolveSessionPersonId(session);
      if (!personResolution.ok) {
        if (personResolution.authFailed) {
          upstreamAuthorizationError(request, response, session, 'marcações diárias');
          return;
        }
        if (personResolution.lookupFailed) {
          json(response, 502, { error: 'Não foi possível identificar o funcionário para consultar as solicitações.' });
          return;
        }
        json(response, 502, { error: 'O portal RHiD não informou o funcionário da sessão.' });
        return;
      }
      const idPerson = personResolution.idPerson;
      const requestSession = personResolution.session;

      const { response: rhidResponse, body } = await requestPortalRequestsList(requestSession, idPerson, startDate, endDate);
      if (rhidResponse.status === 401 || rhidResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'solicitações');
        return;
      }
      if (!rhidResponse.ok) {
        json(response, 502, { error: 'Não foi possível consultar as solicitações no portal RHiD.' });
        return;
      }
      const localRequests = localRequestsForSession(session, startDate, endDate);
      json(response, 200, {
        data: { remote: body, local: localRequests },
        syncedAt: new Date().toISOString(),
        idPerson,
        startDate,
        endDate,
        source: 'portal-requests',
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/requests/diagnostics') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (!session.workerDaily) {
        json(response, 403, { error: 'A sessão atual não permite diagnosticar solicitações pelo portal RHiD.' });
        return;
      }
      const date = normalizedRequestDate(url.searchParams.get('date')) ?? currentRhidDate();
      const personResolution = await resolveSessionPersonId(session);
      if (!personResolution.ok) {
        if (personResolution.authFailed) {
          upstreamAuthorizationError(request, response, session, 'diagnóstico de solicitações');
          return;
        }
        json(response, 502, { error: 'O portal RHiD não informou o funcionário para o diagnóstico.' });
        return;
      }
      const { idPerson, session: requestSession } = personResolution;
      const { response: listResponse, body: listBody } = await requestPortalRequestsList(requestSession, idPerson, date, date);
      if (listResponse.status === 401 || listResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'consulta de solicitações');
        return;
      }
      if (!listResponse.ok) {
        json(response, 502, { error: 'A consulta autenticada de solicitações falhou no portal RHiD.' });
        return;
      }
      const { response: typesResponse, body: typesBody } = await requestExternal(
        `${rhidPortalUrl}/customerdb/justificationtype.svc/b_simplesWithPermissions`,
        { headers: portalHeaders(requestSession) },
      );
      const justificationTypes = requestTypeRecords(typesBody);
      const matchedInclusion = selectOfficialRequestType(typesBody, 'inclusao_marcacao');

      json(response, 200, {
        ok: true,
        authenticated: true,
        workerDaily: true,
        idPerson,
        date,
        requestList: {
          reachable: true,
          responseKind: Array.isArray(listBody) ? 'array' : typeof listBody,
          topLevelKeys: listBody && typeof listBody === 'object' && !Array.isArray(listBody)
            ? Object.keys(listBody).slice(0, 20)
            : [],
        },
        justificationTypes: {
          reachable: typesResponse.ok,
          available: justificationTypes.map((r) => ({ id: r.id, name: r.name ?? r.description, type: r.type })),
          matchedInclusionType: matchedInclusion ? { id: matchedInclusion.id, name: matchedInclusion.name ?? matchedInclusion.description } : null,
        },
        inclusion: {
          endpoint: 'customerdb/justification.svc/a',
          matchedOfficialType: matchedInclusion ? { id: matchedInclusion.id, name: matchedInclusion.name ?? matchedInclusion.description } : null,
          payloadAcceptedLocally: Boolean(matchedInclusion),
          mutationPerformed: false,
        },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/rhid/requests') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (!session.workerDaily) {
        json(response, 403, { error: 'A sessão atual não permite criar solicitações pelo portal RHiD.' });
        return;
      }
      const input = await readJson(request);
      const type = typeof input?.type === 'string' ? input.type.trim() : '';
      const startDate = normalizedRequestDate(input?.startDate);
      const endDate = normalizedRequestDate(input?.endDate, startDate);
      if (!type || !startDate || !endDate) {
        json(response, 400, { error: 'Revise o tipo, o período e a justificativa da solicitação.' });
        return;
      }
      const personResolution = await resolveSessionPersonId(session);
      if (!personResolution.ok) {
        if (personResolution.authFailed) {
          upstreamAuthorizationError(request, response, session, 'marcações diárias');
          return;
        }
        if (personResolution.lookupFailed) {
          json(response, 502, { error: 'Não foi possível identificar o funcionário para criar a solicitação.' });
          return;
        }
        json(response, 502, { error: 'O portal RHiD não informou o funcionário da sessão.' });
        return;
      }
      const requestSession = personResolution.session;
      const idPerson = personResolution.idPerson;
      if (type === 'inclusao_marcacao' && !input?.time) {
        json(response, 400, {
          error: 'Para inclusão de marcação, informe uma única data e um horário válido.',
        });
        return;
      }

      const { response: typesResponse, body: typesBody } = await requestExternal(
        `${rhidPortalUrl}/customerdb/justificationtype.svc/b_simplesWithPermissions`,
        { headers: portalHeaders(requestSession) },
      );
      if (typesResponse.status === 401 || typesResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'tipos de solicitação');
        return;
      }
      if (!typesResponse.ok) {
        json(response, 502, { error: 'O RHiD não disponibilizou os tipos de solicitação permitidos para esta conta.' });
        return;
      }
      const officialType = selectOfficialRequestType(typesBody, type);
      if (!officialType || !Number.isFinite(Number(officialType.id))) {
        const records = requestTypeRecords(typesBody);
        const availableNames = records
          .map((r) => r?.name ?? r?.description ?? r?.abreviation)
          .filter(Boolean)
          .join(', ');
        json(response, 422, {
          error: `O tipo selecionado não está habilitado no RHiD para esta conta. Tipos disponíveis no RHiD: [${availableNames || 'nenhum'}]. A solicitação não foi gravada como enviada.`,
        });
        return;
      }
      const remotePayload = officialRequestPayload(requestSession, { ...input, startDate, endDate }, officialType);
      const remoteUrl = `${rhidPortalUrl}/customerdb/justification.svc/a`;

      const { response: createResponse, body: createBody } = await requestExternal(
        remoteUrl,
        {
          method: 'POST',
          headers: { ...portalHeaders(requestSession), 'Content-Type': 'application/json' },
          body: JSON.stringify(remotePayload),
        },
      );
      if (createResponse.status === 401 || createResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'criação da solicitação');
        return;
      }
      console.log('[RHID CREATE REQUEST RESULT]', {
        status: createResponse.status,
        body: createBody,
      });
      const remoteError = remoteRequestError(createBody);
      if (!createResponse.ok || remoteError) {
        const errorDetail = remoteError
          || (!isSuccessIndicator(createBody?.message) ? createBody?.message : null)
          || `O RHiD rejeitou a solicitação (HTTP ${createResponse.status}). Nenhum sucesso local foi registrado.`;
        json(response, 502, {
          error: String(errorDetail),
        });
        return;
      }
      const remoteId = createBody?.newID ?? createBody?.id ?? createBody?.data?.id ?? `rhid:${randomUUID()}`;
      let confirmedRemotely = false;
      for (let attempt = 0; attempt < requestConfirmationAttempts; attempt += 1) {
        const { response: confirmResponse, body: confirmBody } = await requestPortalRequestsList(requestSession, idPerson, startDate, endDate);
        if (confirmResponse.status === 401 || confirmResponse.status === 403) {
          upstreamAuthorizationError(request, response, session, 'confirmação da solicitação');
          return;
        }
        if (!confirmResponse.ok) {
          json(response, 502, { error: 'O RHiD respondeu à criação, mas falhou ao confirmar a solicitação no portal autenticado.' });
          return;
        }
        confirmedRemotely = remoteRequestWasConfirmed(confirmBody, {
          remoteId,
          startDate,
          endDate,
          description: input?.description,
          notes: input?.notes,
          time: input?.time,
          aliases: requestTypeAliases[type] ?? [type.replaceAll('_', ' ')],
        });
        if (confirmedRemotely) {
          break;
        }
        if (attempt + 1 < requestConfirmationAttempts) {
          await new Promise((resolve) => setTimeout(resolve, requestConfirmationIntervalMs));
        }
      }
      if (!confirmedRemotely) {
        json(response, 502, {
          error: 'O RHiD aceitou a solicitação, mas ela não pôde ser confirmada no portal autenticado. Atualize as solicitações e tente novamente.',
        });
        return;
      }
      const requestRecord = persistLocalRequest(requestSession, { ...input, startDate, endDate }, {
        id: String(remoteId).startsWith('rhid:') ? remoteId : `rhid:${remoteId}`,
        status: 'pending',
        source: 'rhid',
        remoteResponse: createBody,
      });
      if (!requestRecord) {
        json(response, 500, { error: 'O RHiD aceitou a solicitação, mas houve falha ao salvar a confirmação local.' });
        return;
      }
      deleteRetriedLocalRequest(requestSession, input.retryOf);
      json(response, 200, { request: requestRecord });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/rhid/punch') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (!session.workerDaily) {
        json(response, 403, { error: 'A sessão atual não permite marcação web pelo portal RHiD.' });
        return;
      }
      if (!officialPunchEnabled) {
        json(response, 403, {
          error: 'Marcação oficial bloqueada neste ambiente. O modo de teste não envia ponto ao RHiD.',
        });
        return;
      }
      const input = await readJson(request);
      const automatic = input.automatic === true;
      const submissionKey = sessionPunchKey(session);
      if (!punchSubmissionCoordinator.tryAcquire(submissionKey)) {
        json(response, 409, {
          code: 'PUNCH_SUBMISSION_IN_FLIGHT',
          error: 'Já existe uma marcação desta conta em processamento. Aguarde a confirmação do RHiD antes de tentar novamente.',
        });
        return;
      }
      try {
      const { response: dailyResponse, body: dailyBody } = await requestPortalDaily(session);
      if (dailyResponse.status === 401 || dailyResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'marcações diárias');
        return;
      }
      if (!dailyResponse.ok) {
        json(response, 502, {
          error: 'Não foi possível conferir as marcações de hoje antes de registrar o ponto. Atualize e tente novamente.',
        });
        return;
      }
      const dailyPunches = portalPunchesForToday(dailyBody);
      persistPortalPunchLocations(session, dailyPunches);
      const submissionAuthorization = punchSubmissionAuthorization({
        automatic,
        confirmed: input.confirmed,
        expectedPunchCount: input.expectedPunchCount,
        actualPunchCount: dailyPunches.length,
      });
      if (!submissionAuthorization.ok) {
        json(response, 409, {
          code: submissionAuthorization.code,
          error: submissionAuthorization.error,
        });
        return;
      }
      const portalTimestamps = dailyPunches
        .map((entry) => portalPunchTimestamp(entry))
        .filter((timestamp) => timestamp !== null);

      if (automatic) {
        if (dailyPunches.length === 2) {
          const lunchExitAt = portalTimestamps[1];
          const lunchDecision = automaticLunchWindowDecision({ automatic: true, lunchExitAt });
          if (lunchDecision.code === 'AUTOMATIC_LUNCH_OUTSIDE_WINDOW') {
            json(response, 409, {
              code: lunchDecision.code,
              error: 'A marcação automática da Entrada 2 está fora da janela segura de execução.',
              retryAt: new Date(lunchDecision.retryAt).toISOString(),
            });
            return;
          }
          if (lunchDecision.code === 'AUTOMATIC_LUNCH_STATE_INVALID') {
            json(response, 409, {
              code: lunchDecision.code,
              error: 'A marcação automática exige exatamente a Entrada 1 e a Saída 1 confirmadas no RHiD.',
            });
            return;
          }
        } else if (dailyPunches.length === 3) {
          const safetyDecision = automaticSafetyExitDecision({
            punches: portalTimestamps,
            targetMinutes: DEFAULT_TARGET_MINUTES,
            now: Date.now(),
          });
          if (!safetyDecision.allowed) {
            json(response, 409, {
              code: safetyDecision.code,
              error: safetyDecision.message || 'A marcação automática da Saída 2 ainda não atingiu o limite de segurança.',
              retryAt: safetyDecision.retryAt ? new Date(safetyDecision.retryAt).toISOString() : null,
            });
            return;
          }
        } else {
          json(response, 409, {
            code: 'AUTOMATIC_PUNCH_STATE_INVALID',
            error: 'A marcação automática só é permitida para retorno do almoço (2 marcações) ou saída de segurança (3 marcações).',
          });
          return;
        }
      } else {
        const lunchExitAt = portalTimestamps.length === 2 ? portalTimestamps[1] : null;
        const lunchDecision = automaticLunchWindowDecision({ automatic: false, lunchExitAt });
        if (lunchDecision.code === 'AUTOMATIC_LUNCH_MANUAL_LOCK_ACTIVE') {
          json(response, 409, {
            code: lunchDecision.code,
            error: 'A Entrada 2 está protegida pela automação do almoço. A marcação manual permanece bloqueada durante a janela de segurança.',
            retryAt: new Date(lunchDecision.retryAt).toISOString(),
          });
          return;
        }
      }
      const completedRetryAt = completedJourneyRetryAt(portalTimestamps);
      if (completedRetryAt && Date.now() < completedRetryAt) {
        json(response, 409, {
          code: 'COMPLETED_JOURNEY_LOCK_ACTIVE',
          error: 'Jornada mínima concluída com quatro marcações. Novos registros ficam bloqueados por quatro horas por segurança.',
          retryAt: new Date(completedRetryAt).toISOString(),
        });
        return;
      }
      const recentSubmission = Math.max(
        recentPunchSubmissions.get(sessionPunchKey(session)) ?? 0,
        persistedSubmissionAt(session) ?? 0,
      );
      const lastPunchAt = Math.max(recentSubmission ?? 0, ...portalTimestamps);
      const retryAt = lastPunchAt + minimumPunchIntervalMs;
      if (lastPunchAt > 0 && Date.now() < retryAt) {
        const remainingMinutes = Math.ceil((retryAt - Date.now()) / 60_000);
        json(response, 409, {
          code: 'PUNCH_INTERVAL_ACTIVE',
          error: `Aguarde ${remainingMinutes} minuto(s) para registrar uma nova marcação. O intervalo mínimo entre registros é de 25 minutos.`,
          retryAt: new Date(retryAt).toISOString(),
        });
        return;
      }
      const latitude = Number(input.latitude);
      const longitude = Number(input.longitude);
      const accuracy = Number(input.accuracy);
      const timestamp = Number(input.timestamp);
      const day = currentRhidDate().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      if (
        !Number.isFinite(latitude)
        || latitude < -90
        || latitude > 90
        || !Number.isFinite(longitude)
        || longitude < -180
        || longitude > 180
      ) {
        json(response, 400, { error: 'Não foi possível obter uma localização válida para registrar o ponto.' });
        return;
      }
      const coords = {
        latitude,
        longitude,
        accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      };
      const submittedPoint = validCoordinatePoint({
        latitude,
        longitude,
        accuracy: coords.accuracy,
        capturedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
      });
      if (!submittedPoint) {
        json(response, 400, { error: 'Não foi possível obter uma localização válida para registrar o ponto.' });
        return;
      }
      let automaticReferenceSource = null;
      if (automatic) {
        const resolved = automaticLocationReferences(session, day, dailyPunches);
        const locationDecision = automaticLocationDecision(submittedPoint, resolved.references);
        if (locationDecision.code === 'AUTOMATIC_LOCATION_REFERENCE_MISSING') {
          json(response, 409, {
            code: locationDecision.code,
            error: 'A marcação automática foi bloqueada porque não há duas localizações do dia nem um local pré-cadastrado válido para esta data.',
          });
          return;
        }
        if (locationDecision.code === 'AUTOMATIC_LOCATION_OUTSIDE_RANGE') {
          json(response, 409, {
            code: locationDecision.code,
            error: `A marcação automática foi bloqueada: a posição atual está a ${Math.round(locationDecision.nearestDistance)} m da faixa autorizada de 100 m.`,
          });
          return;
        }
        automaticReferenceSource = resolved.source;
      }
      const payload = {
        position: {
          coords,
          timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        },
        latitude: latitude.toFixed(10),
        longitude: longitude.toFixed(10),
      };
      const { response: rhidResponse, body } = await requestExternal(`${rhidReppUrl}/marcacao_web`, {
        method: 'POST',
        headers: { ...portalHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (rhidResponse.status === 401 || rhidResponse.status === 403) {
        upstreamAuthorizationError(request, response, session, 'marcação web');
        return;
      }
      if (!rhidResponse.ok || !body || typeof body !== 'object' || Number(body.status) === 0) {
        json(response, 502, {
          error: body?.error || 'O RHiD não confirmou a marcação. Atualize a consulta e tente novamente.',
        });
        return;
      }
      const acceptedAt = new Date().toISOString();
      const acceptedValue = new Date(acceptedAt).getTime();
      recentPunchSubmissions.set(sessionPunchKey(session), acceptedValue);
      persistSubmission(session, acceptedValue);
      if (submittedPoint) {
        persistPunchLocation(
          session,
          day,
          dailyPunches.length,
          submittedPoint,
          automatic ? 'automatic-app-submission' : 'manual-app-submission',
          body.retorno?.datetime ?? acceptedAt,
        );
      }
      if (automatic) {
        recordAutomationExecution({
          accountKey: sessionPunchKey(session),
          day,
          rule: dailyPunches.length === 2 ? 'automatic_lunch_return' : 'automatic_safety_exit',
          status: 'success',
          punchIndex: dailyPunches.length,
          details: { hash: body.retorno?.hash ?? null, datetime: body.retorno?.datetime ?? acceptedAt, origin: 'client_request' },
        });
      }
      json(response, 200, {
        registered: true,
        datetime: body.retorno?.datetime ?? null,
        hash: body.retorno?.hash ?? null,
        acceptedAt,
        automaticReferenceSource,
      });
      return;
      } finally {
        punchSubmissionCoordinator.release(submissionKey);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/rhid/automation/evaluate') {
      const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(clientIp);
      const internalToken = request.headers['x-automation-secret'] || url.searchParams.get('secret');
      const authorizedInternal = Boolean(process.env.AUTOMATION_SECRET && internalToken === process.env.AUTOMATION_SECRET) || isLoopback;

      let simulatedNow = Date.now();
      let filterAccountKey = null;
      if (!authorizedInternal) {
        const session = await requireSession(request, response);
        if (!session) return;
        if (!session.workerDaily) {
          json(response, 403, { error: 'A sessão atual não permite automação de ponto.' });
          return;
        }
        filterAccountKey = sessionPunchKey(session);
      } else {
        const body = await readJson(request).catch(() => ({}));
        if (body?.now && Number.isFinite(Number(body.now))) {
          simulatedNow = Number(body.now);
        } else if (url.searchParams.get('now') && Number.isFinite(Number(url.searchParams.get('now')))) {
          simulatedNow = Number(url.searchParams.get('now'));
        }
      }
      const evalResult = await evaluateAutomations({ now: simulatedNow, filterAccountKey });
      json(response, 200, { ok: true, evalResult });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/rhid/automation/logs') {
      const session = await requireSession(request, response);
      if (!session) return;
      const accountKey = sessionPunchKey(session);
      const logs = listAutomationLogs(accountKey, 50);
      json(response, 200, { logs });
      return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/rhid/automation-settings') {
      const session = await requireSession(request, response);
      if (!session) return;
      const accountKey = sessionPunchKey(session);
      const input = await readJson(request);
      const targetMinutes = Number.isSafeInteger(Number(input.targetMinutes)) && Number(input.targetMinutes) > 0
        ? Number(input.targetMinutes)
        : DEFAULT_TARGET_MINUTES;
      const autoLunch = input.automaticLunchEnabled === false ? 0 : 1;
      const autoSafetyExit = input.automaticSafetyExitEnabled === false ? 0 : 1;
      database.prepare(`
        UPDATE active_sessions
        SET target_minutes = ?, automatic_lunch_enabled = ?, automatic_safety_exit_enabled = ?, updated_at = ?
        WHERE account_key = ?
      `).run(targetMinutes, autoLunch, autoSafetyExit, new Date().toISOString(), accountKey);
      json(response, 200, { ok: true, targetMinutes, automaticLunchEnabled: Boolean(autoLunch), automaticSafetyExitEnabled: Boolean(autoSafetyExit) });
      return;
    }

    if (await serveStatic(request, response, url)) {
      return;
    }

    json(response, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    const networkMessage = upstreamNetworkErrorMessage(error);
    if (networkMessage) {
      json(response, 502, { error: networkMessage });
      return;
    }
    json(response, 500, { error: 'Falha interna na integração RHiD.' });
  }
});

server.listen(port, host, () => {
  console.log(`RHiD integration API available at http://${host}:${port}/api`);
  if (serveStaticEnabled) {
    console.log(`Static app base: http://${host}:${port}${publicBase}`);
  }
  startAutomationScheduler();
});

export {
  server,
  listAutomationLogs,
};

