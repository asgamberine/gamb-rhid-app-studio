export function punchSubmissionAuthorization({
  automatic,
  confirmed,
  expectedPunchCount,
  actualPunchCount,
}) {
  const expected = Number(expectedPunchCount);
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== actualPunchCount) {
    return {
      ok: false,
      code: 'PUNCH_STATE_CHANGED',
      error: 'As marcações do dia mudaram. Atualize o RHiD antes de tentar novamente.',
    };
  }
  if (!automatic && actualPunchCount > 0 && confirmed !== true) {
    return {
      ok: false,
      code: 'MANUAL_CONFIRMATION_REQUIRED',
      error: 'Esta marcação exige confirmação explícita após a atualização do RHiD.',
    };
  }
  return { ok: true };
}
