import { describe, expect, it } from 'vitest';
import { manualOfficialPunchRequiresConfirmation } from './registration';

describe('manualOfficialPunchRequiresConfirmation', () => {
  it('registers the first daily punch without a second confirmation', () => {
    expect(manualOfficialPunchRequiresConfirmation({
      automatic: false,
      dailyPunchCount: 0,
    })).toBe(false);
  });

  it('keeps confirmation for later manual punches on the same day', () => {
    expect(manualOfficialPunchRequiresConfirmation({
      automatic: false,
      dailyPunchCount: 1,
    })).toBe(true);
  });

  it('skips confirmation only for the automatic lunch flow', () => {
    expect(manualOfficialPunchRequiresConfirmation({
      automatic: true,
      dailyPunchCount: 2,
    })).toBe(false);
    expect(manualOfficialPunchRequiresConfirmation({
      automatic: false,
      dailyPunchCount: 2,
    })).toBe(true);
  });
});
