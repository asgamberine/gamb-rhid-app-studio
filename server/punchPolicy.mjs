export const MINIMUM_PUNCH_INTERVAL_MS = 25 * 60_000;
export const AUTOMATIC_LUNCH_PREPARATION_MS = 58 * 60_000;
export const AUTOMATIC_LUNCH_RETURN_MS = 59 * 60_000;
export const AUTOMATIC_LUNCH_LOCK_END_MS = AUTOMATIC_LUNCH_RETURN_MS + MINIMUM_PUNCH_INTERVAL_MS;
export const AUTOMATIC_LOCATION_RADIUS_METERS = 100;
export const SAFETY_EXIT_ADDITIONAL_TIME_MS = 105 * 60_000; // 01:45 = 105 minutos
export const DEFAULT_TARGET_MINUTES = 480; // 8 horas
const MINUTE_MS = 60_000;

function floorToMinute(value) {
  return Math.floor(value / MINUTE_MS) * MINUTE_MS;
}

export function automaticLunchWindowDecision({ automatic, lunchExitAt, now = Date.now() }) {
  if (lunchExitAt === null) {
    return automatic
      ? { allowed: false, code: 'AUTOMATIC_LUNCH_STATE_INVALID', retryAt: null }
      : { allowed: true, code: null, retryAt: null };
  }

  const minuteAlignedLunchExitAt = floorToMinute(lunchExitAt);
  const preparationAt = minuteAlignedLunchExitAt + AUTOMATIC_LUNCH_PREPARATION_MS;
  const automaticAt = minuteAlignedLunchExitAt + AUTOMATIC_LUNCH_RETURN_MS;
  const lockUntil = minuteAlignedLunchExitAt + AUTOMATIC_LUNCH_LOCK_END_MS;

  if (!automatic && now >= preparationAt && now < lockUntil) {
    return {
      allowed: false,
      code: 'AUTOMATIC_LUNCH_MANUAL_LOCK_ACTIVE',
      retryAt: lockUntil,
    };
  }
  if (automatic && (now < automaticAt || now >= lockUntil)) {
    return {
      allowed: false,
      code: 'AUTOMATIC_LUNCH_OUTSIDE_WINDOW',
      retryAt: automaticAt,
    };
  }
  return { allowed: true, code: null, retryAt: null };
}

export function calculateSafetyExitThreshold(punches = [], targetMinutes = DEFAULT_TARGET_MINUTES) {
  if (!Array.isArray(punches) || punches.length < 3) {
    return null;
  }
  const timestamps = punches.slice(0, 3).map((punch) => {
    const val = typeof punch === 'number' ? punch : Date.parse(punch?.timestamp ?? punch);
    return Number.isFinite(val) ? val : null;
  });
  if (timestamps.some((val) => val === null)) {
    return null;
  }
  const [t0, t1, t2] = timestamps;
  if (t0 >= t1 || t1 >= t2) {
    return null;
  }
  const targetMs = targetMinutes * MINUTE_MS;
  const firstPeriodWorkedMs = Math.max(t1 - t0, 0);
  const remainingWorkMs = Math.max(targetMs - firstPeriodWorkedMs, 0);
  const plannedFinishAt = t2 + remainingWorkMs;
  return Math.max(plannedFinishAt + SAFETY_EXIT_ADDITIONAL_TIME_MS, t2 + MINIMUM_PUNCH_INTERVAL_MS);
}

export function automaticSafetyExitDecision({
  punches = [],
  targetMinutes = DEFAULT_TARGET_MINUTES,
  now = Date.now(),
}) {
  if (!Array.isArray(punches)) {
    return { allowed: false, code: 'SAFETY_EXIT_STATE_INVALID', retryAt: null };
  }

  if (punches.length >= 4) {
    return {
      allowed: false,
      code: 'SAFETY_EXIT_ALREADY_COMPLETED',
      retryAt: null,
      message: 'A segunda saida ja esta registrada para o dia.',
    };
  }

  if (punches.length < 3) {
    return {
      allowed: false,
      code: 'SAFETY_EXIT_INCOMPLETE_SEQUENCE',
      retryAt: null,
      message: 'A segunda saida exige exatamente Entrada 1, Saida 1 e Entrada 2 (retorno) confirmadas.',
    };
  }

  const timestamps = punches.map((punch) => {
    const val = typeof punch === 'number' ? punch : Date.parse(punch?.timestamp ?? punch);
    return Number.isFinite(val) ? val : null;
  });

  if (timestamps.some((val) => val === null)) {
    return { allowed: false, code: 'SAFETY_EXIT_STATE_INVALID', retryAt: null };
  }

  const [t0, t1, t2] = timestamps;

  if (t0 >= t1 || t1 >= t2) {
    return {
      allowed: false,
      code: 'SAFETY_EXIT_INCONSISTENT_SEQUENCE',
      retryAt: null,
      message: 'A sequencia das marcacoes do dia e inconsistente.',
    };
  }

  const targetMs = targetMinutes * MINUTE_MS;
  const firstPeriodWorkedMs = Math.max(t1 - t0, 0);
  const remainingWorkMs = Math.max(targetMs - firstPeriodWorkedMs, 0);
  const plannedFinishAt = t2 + remainingWorkMs;
  const safetyThresholdAt = plannedFinishAt + SAFETY_EXIT_ADDITIONAL_TIME_MS;
  const minIntervalAt = t2 + MINIMUM_PUNCH_INTERVAL_MS;
  const effectiveThresholdAt = Math.max(safetyThresholdAt, minIntervalAt);

  if (now < effectiveThresholdAt) {
    return {
      allowed: false,
      code: 'SAFETY_EXIT_BEFORE_THRESHOLD',
      retryAt: effectiveThresholdAt,
      plannedFinishAt,
      safetyThresholdAt: effectiveThresholdAt,
      remainingMs: effectiveThresholdAt - now,
    };
  }

  return {
    allowed: true,
    code: null,
    retryAt: null,
    plannedFinishAt,
    safetyThresholdAt: effectiveThresholdAt,
  };
}

export function automaticLocationDecision(submittedPoint, references) {
  if (!submittedPoint) {
    return { allowed: false, code: 'AUTOMATIC_LOCATION_REFERENCE_MISSING', nearestDistance: null };
  }
  if (references.length === 0) {
    return { allowed: false, code: 'AUTOMATIC_LOCATION_REFERENCE_MISSING', nearestDistance: null };
  }

  const nearestDistance = Math.min(
    ...references.map((reference) => locationDistanceMeters(submittedPoint, reference)),
  );
  return nearestDistance <= AUTOMATIC_LOCATION_RADIUS_METERS
    ? { allowed: true, code: null, nearestDistance }
    : { allowed: false, code: 'AUTOMATIC_LOCATION_OUTSIDE_RANGE', nearestDistance };
}

function degreesToRadians(value) {
  return value * (Math.PI / 180);
}

function locationDistanceMeters(left, right) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}
