import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookieHeader,
  sessionCookieHeader,
} from './sessionCookie.mjs';

describe('production session cookie', () => {
  it('uses a versioned name so legacy cookies cannot shadow a fresh login', () => {
    expect(SESSION_COOKIE_NAME).toBe('gamb_rhid_session_v2');
  });

  it('is host-only, secure and inaccessible to JavaScript in production', () => {
    const header = sessionCookieHeader('encrypted session', {
      secure: true,
      maxAgeSeconds: 3600,
    });

    expect(header).toContain('gamb_rhid_session_v2=encrypted%20session');
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Secure');
    expect(header).not.toContain('Domain=');
  });

  it('clears the same versioned host-only cookie', () => {
    expect(clearSessionCookieHeader({ secure: true })).toBe(
      'gamb_rhid_session_v2=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure',
    );
  });
});
