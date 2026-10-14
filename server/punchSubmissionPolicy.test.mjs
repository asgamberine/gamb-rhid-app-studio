import { describe, expect, it } from 'vitest';
import { punchSubmissionAuthorization } from './punchSubmissionPolicy.mjs';

describe('punchSubmissionAuthorization', () => {
  it('allows the first manual punch without a second confirmation', () => {
    expect(punchSubmissionAuthorization({
      automatic: false,
      confirmed: false,
      expectedPunchCount: 0,
      actualPunchCount: 0,
    })).toEqual({ ok: true });
  });

  it('blocks a later manual punch without explicit confirmation', () => {
    expect(punchSubmissionAuthorization({
      automatic: false,
      confirmed: false,
      expectedPunchCount: 4,
      actualPunchCount: 4,
    })).toMatchObject({ ok: false, code: 'MANUAL_CONFIRMATION_REQUIRED' });
  });

  it('blocks stale screens even when they claim confirmation', () => {
    expect(punchSubmissionAuthorization({
      automatic: false,
      confirmed: true,
      expectedPunchCount: 3,
      actualPunchCount: 4,
    })).toMatchObject({ ok: false, code: 'PUNCH_STATE_CHANGED' });
  });

  it('allows the automatic lunch return only against the expected official state', () => {
    expect(punchSubmissionAuthorization({
      automatic: true,
      confirmed: false,
      expectedPunchCount: 2,
      actualPunchCount: 2,
    })).toEqual({ ok: true });
  });
});
