import { describe, expect, it } from 'vitest';
import { createPunchSubmissionCoordinator } from './punchSubmissionCoordinator.mjs';

describe('punch submission coordinator', () => {
  it('blocks a concurrent submission for the same account', () => {
    const coordinator = createPunchSubmissionCoordinator();

    expect(coordinator.tryAcquire('worker@example.com:company')).toBe(true);
    expect(coordinator.tryAcquire('worker@example.com:company')).toBe(false);
  });

  it('allows another submission after the first one releases the account', () => {
    const coordinator = createPunchSubmissionCoordinator();

    expect(coordinator.tryAcquire('worker@example.com:company')).toBe(true);
    coordinator.release('worker@example.com:company');
    expect(coordinator.tryAcquire('worker@example.com:company')).toBe(true);
  });

  it('does not block a different account', () => {
    const coordinator = createPunchSubmissionCoordinator();

    expect(coordinator.tryAcquire('first@example.com:company')).toBe(true);
    expect(coordinator.tryAcquire('second@example.com:company')).toBe(true);
  });
});
