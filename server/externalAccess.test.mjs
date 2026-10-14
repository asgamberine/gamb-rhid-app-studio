import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  createFixedWindowLimiter,
  externalAccessConfig,
  isExternalAccessAuthorized,
  requestClientIp,
} from './externalAccess.mjs';

function request(headers = {}, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

describe('external access protection', () => {
  it('stays disabled when no credentials are configured', () => {
    expect(externalAccessConfig({})).toBeNull();
    expect(isExternalAccessAuthorized(request(), null)).toBe(true);
  });

  it('requires complete strong credentials', () => {
    expect(() => externalAccessConfig({
      EXTERNAL_ACCESS_USERNAME: 'gamb',
      EXTERNAL_ACCESS_PASSWORD: 'short',
    })).toThrow(/16 caracteres/);
  });

  it('accepts only the configured basic authentication credentials', () => {
    const config = externalAccessConfig({
      EXTERNAL_ACCESS_USERNAME: 'gamb',
      EXTERNAL_ACCESS_PASSWORD: 'a-secure-password',
    });
    const valid = `Basic ${Buffer.from('gamb:a-secure-password').toString('base64')}`;
    const invalid = `Basic ${Buffer.from('gamb:wrong-password').toString('base64')}`;

    expect(isExternalAccessAuthorized(request({ authorization: valid }), config)).toBe(true);
    expect(isExternalAccessAuthorized(request({ authorization: invalid }), config)).toBe(false);
    expect(isExternalAccessAuthorized(request(), config)).toBe(false);
  });

  it('uses proxy client addresses only when explicitly trusted', () => {
    const proxied = request({
      'cf-connecting-ip': '203.0.113.10',
      'x-forwarded-for': '198.51.100.20',
    }, '127.0.0.1');

    expect(requestClientIp(proxied, false)).toBe('127.0.0.1');
    expect(requestClientIp(proxied, true)).toBe('203.0.113.10');
  });

  it('blocks attempts until the fixed window expires', () => {
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000 });

    expect(limiter.check('client', 0).allowed).toBe(true);
    expect(limiter.check('client', 100).allowed).toBe(true);
    expect(limiter.check('client', 200)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.check('client', 1_000).allowed).toBe(true);
  });
});
