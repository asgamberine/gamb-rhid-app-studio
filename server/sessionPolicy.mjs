export const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function normalizedSessionMaxAgeSeconds(value) {
  const parsed = Number(value ?? DEFAULT_SESSION_MAX_AGE_SECONDS);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SESSION_MAX_AGE_SECONDS;
}

export function sessionIsCurrent(session, maxAgeSeconds, now = Date.now()) {
  const createdAt = Date.parse(String(session?.createdAt ?? ''));
  if (!Number.isFinite(createdAt)) return false;
  const ageMs = now - createdAt;
  return ageMs >= 0 && ageMs <= maxAgeSeconds * 1_000;
}
