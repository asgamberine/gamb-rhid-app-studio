import { timingSafeEqual } from 'node:crypto';

function firstHeaderValue(value) {
  return String(value ?? '').split(',')[0].trim();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function externalAccessConfig(environment = process.env) {
  const username = String(environment.EXTERNAL_ACCESS_USERNAME ?? '').trim();
  const password = String(environment.EXTERNAL_ACCESS_PASSWORD ?? '');
  if (!username && !password) {
    return null;
  }
  if (!username || password.length < 16) {
    throw new Error(
      'EXTERNAL_ACCESS_USERNAME e EXTERNAL_ACCESS_PASSWORD devem ser definidos; a senha precisa ter ao menos 16 caracteres.',
    );
  }
  return { username, password };
}

export function isExternalAccessAuthorized(request, config) {
  if (!config) {
    return true;
  }
  const authorization = String(request.headers.authorization ?? '');
  if (!authorization.startsWith('Basic ')) {
    return false;
  }
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) {
      return false;
    }
    return safeEqual(decoded.slice(0, separator), config.username)
      && safeEqual(decoded.slice(separator + 1), config.password);
  } catch {
    return false;
  }
}

export function requestClientIp(request, trustProxy = false) {
  if (trustProxy) {
    const cloudflareIp = firstHeaderValue(request.headers['cf-connecting-ip']);
    const forwardedIp = firstHeaderValue(request.headers['x-forwarded-for']);
    if (cloudflareIp || forwardedIp) {
      return cloudflareIp || forwardedIp;
    }
  }
  return request.socket?.remoteAddress ?? 'unknown';
}

export function createFixedWindowLimiter({ limit, windowMs }) {
  const attempts = new Map();

  return {
    check(key, now = Date.now()) {
      const current = attempts.get(key);
      if (!current || now >= current.resetAt) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }
      if (current.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
      }
      current.count += 1;
      return { allowed: true, remaining: limit - current.count, retryAfterSeconds: 0 };
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}
