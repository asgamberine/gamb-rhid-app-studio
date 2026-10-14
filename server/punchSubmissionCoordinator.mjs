export function createPunchSubmissionCoordinator() {
  const activeAccounts = new Set();

  return {
    tryAcquire(accountKey) {
      if (!accountKey || activeAccounts.has(accountKey)) {
        return false;
      }
      activeAccounts.add(accountKey);
      return true;
    },
    release(accountKey) {
      activeAccounts.delete(accountKey);
    },
  };
}
