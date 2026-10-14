import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectedRequestOrigins, isTrustedMutationRequest, trustedCorsOrigin } from './requestSecurity.mjs';

function request(method, headers = {}, encrypted = false) {
  return { method, headers, socket: { encrypted } };
}

describe('request origin protection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts same-origin mutation requests', () => {
    expect(isTrustedMutationRequest(request('POST', {
      host: '127.0.0.1:8787',
      origin: 'http://127.0.0.1:8787',
    }))).toBe(true);
  });

  it('rejects missing and foreign origins on mutation requests', () => {
    expect(isTrustedMutationRequest(request('POST', { host: '127.0.0.1:8787' }))).toBe(false);
    expect(isTrustedMutationRequest(request('POST', {
      host: '127.0.0.1:8787',
      origin: 'http://127.0.0.1:9999',
    }))).toBe(false);
  });

  it('uses forwarded production protocol and host', () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    const proxied = request('PUT', {
      host: '127.0.0.1:8787',
      origin: 'https://jornada.example.com',
      'x-forwarded-host': 'jornada.example.com',
      'x-forwarded-proto': 'https',
    });

    expect(expectedRequestOrigins(proxied)).toContain('https://jornada.example.com');
    expect(isTrustedMutationRequest(proxied)).toBe(true);
  });

  it('rejects spoofed forwarded headers when proxy trust is disabled', () => {
    vi.stubEnv('TRUST_PROXY', 'false');
    const spoofed = request('PUT', {
      host: '127.0.0.1:8787',
      origin: 'https://jornada.example.com',
      'x-forwarded-host': 'jornada.example.com',
      'x-forwarded-proto': 'https',
    });

    expect(expectedRequestOrigins(spoofed)).not.toContain('https://jornada.example.com');
    expect(isTrustedMutationRequest(spoofed)).toBe(false);
  });

  it('does not require an origin for read-only requests', () => {
    expect(isTrustedMutationRequest(request('GET', { host: '127.0.0.1:8787' }))).toBe(true);
  });

  it('uses managed hosting proxy defaults and trusts only the production frontend', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PORT', '3000');
    const proxied = request('POST', {
      host: '127.0.0.1:3000',
      origin: 'https://gamberine.com.br',
      'x-forwarded-host': 'gambrhid-api.gamberine.com.br',
      'x-forwarded-proto': 'https',
    });

    expect(expectedRequestOrigins(proxied)).toEqual([
      'https://gambrhid-api.gamberine.com.br',
      'https://gamberine.com.br',
    ]);
    expect(isTrustedMutationRequest(proxied)).toBe(true);
    expect(trustedCorsOrigin(proxied)).toBe('https://gamberine.com.br');
  });

  it('returns only configured trusted origins for credentialed CORS', () => {
    vi.stubEnv('TRUSTED_ORIGINS', 'https://gamberine.com.br');

    expect(trustedCorsOrigin(request('GET', {
      host: 'gambrhid-api.gamberine.com.br',
      origin: 'https://gamberine.com.br',
    }))).toBe('https://gamberine.com.br');
    expect(trustedCorsOrigin(request('GET', {
      host: 'gambrhid-api.gamberine.com.br',
      origin: 'https://evil.example.com',
    }))).toBeNull();
  });
});

