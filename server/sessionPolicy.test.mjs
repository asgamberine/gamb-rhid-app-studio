import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  normalizedSessionMaxAgeSeconds,
  sessionIsCurrent,
} from './sessionPolicy.mjs';

describe('session lifetime policy', () => {
  it('accepts a valid positive integer lifetime and rejects unsafe values', () => {
    expect(normalizedSessionMaxAgeSeconds('3600')).toBe(3600);
    expect(normalizedSessionMaxAgeSeconds('0')).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
    expect(normalizedSessionMaxAgeSeconds('invalid')).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
  });

  it('rejects missing, future and expired session timestamps', () => {
    const now = Date.parse('2026-08-12T12:00:00.000Z');
    expect(sessionIsCurrent({ createdAt: '2026-08-12T11:30:00.000Z' }, 3600, now)).toBe(true);
    expect(sessionIsCurrent({ createdAt: '2026-08-12T10:59:59.000Z' }, 3600, now)).toBe(false);
    expect(sessionIsCurrent({ createdAt: '2026-08-12T12:00:01.000Z' }, 3600, now)).toBe(false);
    expect(sessionIsCurrent({}, 3600, now)).toBe(false);
  });
});
