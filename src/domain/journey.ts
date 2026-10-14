import dayjs from 'dayjs';
import type { DaySummary, JornadaSettings, OfficialBalanceDay, Punch, RhidPendingDay } from '../types';

export const MINUTE_MS = 60_000;
export const STANDARD_DAILY_PUNCH_LIMIT = 4;
export const OFFICIAL_PUNCH_MIN_INTERVAL_MS = 25 * MINUTE_MS;
export const OFFICIAL_PUNCH_VALIDATION_WINDOW_MS = 51 * MINUTE_MS;
export const MINIMUM_COMPLETED_WORK_MS = 8 * 60 * MINUTE_MS;
export const COMPLETED_JOURNEY_LOCK_MS = 4 * 60 * MINUTE_MS;
// CONTRATO VALIDADO: não alterar o fluxo 58/59 min sem as duas autorizações
// registradas em docs/COMPORTAMENTOS-VALIDADOS.md.
export const AUTOMATIC_LUNCH_MANUAL_LOCK_START_MS = 58 * MINUTE_MS;
export const AUTOMATIC_LUNCH_PREPARATION_MS = 58 * MINUTE_MS;
export const AUTOMATIC_LUNCH_RETURN_MS = 59 * MINUTE_MS;
export const AUTOMATIC_LUNCH_MANUAL_LOCK_END_MS = AUTOMATIC_LUNCH_RETURN_MS + OFFICIAL_PUNCH_MIN_INTERVAL_MS;
const punchLabels = ['Entrada', 'Saída 1 - Almoço', 'Entrada 2 - Retorno Almoço', 'Saída 2 - Fim Jornada'];

function floorToMinute(value: number) {
  return Math.floor(value / MINUTE_MS) * MINUTE_MS;
}

export interface OfficialPunchGate {
  state: 'ready' | 'cooldown' | 'validation';
  referenceAt: string | null;
  nextAllowedAt: number | null;
  validationUntil: number | null;
  remainingMs: number;
  progress: number;
}

export interface CompletedJourneyGate {
  completed: boolean;
  active: boolean;
  completedAt: string | null;
  workedMs: number;
  remainingMs: number;
  progress: number;
}

export interface AutomaticLunchReturnGate {
  active: boolean;
  preparationDue: boolean;
  automaticDue: boolean;
  manualLockActive: boolean;
  lunchExitAt: string | null;
  preparationAt: number | null;
  returnAt: number | null;
  lockUntil: number | null;
  remainingUntilReturnMs: number;
  remainingLockMs: number;
}

export function dayKey(value: Date | string): string {
  return dayjs(value).format('YYYY-MM-DD');
}

export function labelForPunch(index: number): string {
  return punchLabels[index] ?? (index % 2 === 0 ? 'Entrada Extra' : 'Saída Extra');
}

export function nextPunchLabel(count: number): string {
  return labelForPunch(count);
}

export function excessPunchCount(punches: Punch[]): number {
  return Math.max(punches.length - STANDARD_DAILY_PUNCH_LIMIT, 0);
}

export function automaticLunchReturnAt(punches: Punch[], now: Date = new Date()): string | null {
  const gate = automaticLunchReturnGate(punches, now);
  return gate.automaticDue && gate.returnAt !== null ? new Date(gate.returnAt).toISOString() : null;
}

export function automaticLunchReturnGate(punches: Punch[], now: Date = new Date()): AutomaticLunchReturnGate {
  const todayPunches = punches
    .filter((punch) => dayKey(punch.timestamp) === dayKey(now))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (todayPunches.length !== 2) {
    return {
      active: false,
      preparationDue: false,
      automaticDue: false,
      manualLockActive: false,
      lunchExitAt: null,
      preparationAt: null,
      returnAt: null,
      lockUntil: null,
      remainingUntilReturnMs: 0,
      remainingLockMs: 0,
    };
  }

  const lunchExitAt = floorToMinute(dayjs(todayPunches[1].timestamp).valueOf());
  const lockStartAt = lunchExitAt + AUTOMATIC_LUNCH_MANUAL_LOCK_START_MS;
  const preparationAt = lunchExitAt + AUTOMATIC_LUNCH_PREPARATION_MS;
  const returnAt = lunchExitAt + AUTOMATIC_LUNCH_RETURN_MS;
  const lockUntil = lunchExitAt + AUTOMATIC_LUNCH_MANUAL_LOCK_END_MS;
  if (!Number.isFinite(lunchExitAt) || now.getTime() >= lockUntil) {
    return {
      active: false,
      preparationDue: false,
      automaticDue: false,
      manualLockActive: false,
      lunchExitAt: todayPunches[1].timestamp,
      preparationAt,
      returnAt,
      lockUntil,
      remainingUntilReturnMs: 0,
      remainingLockMs: 0,
    };
  }

  return {
    active: true,
    preparationDue: now.getTime() >= preparationAt,
    automaticDue: now.getTime() >= returnAt,
    manualLockActive: now.getTime() >= lockStartAt,
    lunchExitAt: todayPunches[1].timestamp,
    preparationAt,
    returnAt,
    lockUntil,
    remainingUntilReturnMs: Math.max(returnAt - now.getTime(), 0),
    remainingLockMs: Math.max(lockUntil - now.getTime(), 0),
  };
}

export const SAFETY_EXIT_ADDITIONAL_TIME_MS = 105 * MINUTE_MS;
export const DEFAULT_TARGET_MINUTES = 480;

export interface AutomaticSafetyExitGate {
  eligible: boolean;
  plannedFinishAt: number | null;
  safetyThresholdAt: number | null;
  remainingUntilSafetyMs: number;
  safetyDue: boolean;
  reason?: string;
}

export function calculateSafetyExitThreshold(punches: Punch[], targetMinutes = DEFAULT_TARGET_MINUTES): number | null {
  const todayPunches = [...punches].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (todayPunches.length < 3) return null;
  const t0 = dayjs(todayPunches[0].timestamp).valueOf();
  const t1 = dayjs(todayPunches[1].timestamp).valueOf();
  const t2 = dayjs(todayPunches[2].timestamp).valueOf();
  if (t0 >= t1 || t1 >= t2) return null;
  const targetMs = targetMinutes * MINUTE_MS;
  const firstPeriodWorkedMs = Math.max(t1 - t0, 0);
  const remainingWorkMs = Math.max(targetMs - firstPeriodWorkedMs, 0);
  const plannedFinishAt = t2 + remainingWorkMs;
  return Math.max(plannedFinishAt + SAFETY_EXIT_ADDITIONAL_TIME_MS, t2 + OFFICIAL_PUNCH_MIN_INTERVAL_MS);
}

export function automaticSafetyExitGate(
  punches: Punch[],
  targetMinutes = DEFAULT_TARGET_MINUTES,
  now: Date = new Date(),
): AutomaticSafetyExitGate {
  const todayPunches = [...punches].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (todayPunches.length >= 4) {
    return {
      eligible: false,
      plannedFinishAt: null,
      safetyThresholdAt: null,
      remainingUntilSafetyMs: 0,
      safetyDue: false,
      reason: 'Segunda saída já realizada.',
    };
  }
  if (todayPunches.length < 3) {
    return {
      eligible: false,
      plannedFinishAt: null,
      safetyThresholdAt: null,
      remainingUntilSafetyMs: 0,
      safetyDue: false,
      reason: 'Sequência incompleta.',
    };
  }
  const threshold = calculateSafetyExitThreshold(todayPunches, targetMinutes);
  if (!threshold) {
    return {
      eligible: false,
      plannedFinishAt: null,
      safetyThresholdAt: null,
      remainingUntilSafetyMs: 0,
      safetyDue: false,
      reason: 'Sequência inconsistente.',
    };
  }
  const t0 = dayjs(todayPunches[0].timestamp).valueOf();
  const t1 = dayjs(todayPunches[1].timestamp).valueOf();
  const t2 = dayjs(todayPunches[2].timestamp).valueOf();
  const targetMs = targetMinutes * MINUTE_MS;
  const firstPeriodWorkedMs = Math.max(t1 - t0, 0);
  const remainingWorkMs = Math.max(targetMs - firstPeriodWorkedMs, 0);
  const plannedFinishAt = t2 + remainingWorkMs;
  const remainingUntilSafetyMs = Math.max(threshold - now.getTime(), 0);

  return {
    eligible: true,
    plannedFinishAt,
    safetyThresholdAt: threshold,
    remainingUntilSafetyMs,
    safetyDue: now.getTime() >= threshold,
  };
}

export function completedJourneyGate(punches: Punch[], now: Date = new Date()): CompletedJourneyGate {
  const standardPunches = [...punches]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(0, STANDARD_DAILY_PUNCH_LIMIT);
  if (standardPunches.length < STANDARD_DAILY_PUNCH_LIMIT) {
    return {
      completed: false,
      active: false,
      completedAt: null,
      workedMs: 0,
      remainingMs: 0,
      progress: 100,
    };
  }
  const values = standardPunches.map((punch) => dayjs(punch.timestamp).valueOf());
  const workedMs = Math.max(values[1] - values[0], 0) + Math.max(values[3] - values[2], 0);
  if (workedMs < MINIMUM_COMPLETED_WORK_MS) {
    return {
      completed: false,
      active: false,
      completedAt: null,
      workedMs,
      remainingMs: 0,
      progress: 100,
    };
  }
  const elapsedMs = Math.max(now.getTime() - values[3], 0);
  return {
    completed: true,
    active: elapsedMs < COMPLETED_JOURNEY_LOCK_MS,
    completedAt: standardPunches[3].timestamp,
    workedMs,
    remainingMs: Math.max(COMPLETED_JOURNEY_LOCK_MS - elapsedMs, 0),
    progress: Math.min((elapsedMs / COMPLETED_JOURNEY_LOCK_MS) * 100, 100),
  };
}

export function officialPunchGate(
  punches: Punch[],
  latestReceiptAt: string | null,
  lastValidatedAt: string | null,
  now: Date = new Date(),
): OfficialPunchGate {
  const officialTimestamps = punches
    .filter((punch) => punch.origin === 'rhid')
    .map((punch) => ({ timestamp: punch.timestamp, value: dayjs(punch.timestamp).valueOf() }))
    .filter((entry) => Number.isFinite(entry.value));
  const receiptValue = latestReceiptAt ? dayjs(latestReceiptAt).valueOf() : Number.NaN;
  if (Number.isFinite(receiptValue)) {
    officialTimestamps.push({ timestamp: latestReceiptAt as string, value: receiptValue });
  }
  const latest = officialTimestamps.sort((left, right) => right.value - left.value)[0];
  if (!latest) {
    return {
      state: 'ready',
      referenceAt: null,
      nextAllowedAt: null,
      validationUntil: null,
      remainingMs: 0,
      progress: 100,
    };
  }

  const elapsedMs = Math.max(now.getTime() - latest.value, 0);
  const nextAllowedAt = latest.value + OFFICIAL_PUNCH_MIN_INTERVAL_MS;
  const validationUntil = latest.value + OFFICIAL_PUNCH_VALIDATION_WINDOW_MS;
  if (elapsedMs < OFFICIAL_PUNCH_MIN_INTERVAL_MS) {
    return {
      state: 'cooldown',
      referenceAt: latest.timestamp,
      nextAllowedAt,
      validationUntil,
      remainingMs: nextAllowedAt - now.getTime(),
      progress: Math.min((elapsedMs / OFFICIAL_PUNCH_MIN_INTERVAL_MS) * 100, 100),
    };
  }

  const validationTimestamp = lastValidatedAt ? dayjs(lastValidatedAt).valueOf() : Number.NaN;
  if (elapsedMs < OFFICIAL_PUNCH_VALIDATION_WINDOW_MS && (!Number.isFinite(validationTimestamp) || validationTimestamp < nextAllowedAt)) {
    return {
      state: 'validation',
      referenceAt: latest.timestamp,
      nextAllowedAt,
      validationUntil,
      remainingMs: Math.max(validationUntil - now.getTime(), 0),
      progress: 100,
    };
  }

  return {
    state: 'ready',
    referenceAt: latest.timestamp,
    nextAllowedAt,
    validationUntil,
    remainingMs: 0,
    progress: 100,
  };
}

export function formatDuration(valueMs: number, showSign = false): string {
  const sign = valueMs < 0 ? '-' : showSign && valueMs > 0 ? '+' : '';
  const totalMinutes = Math.round(Math.abs(valueMs) / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatDurationWithSeconds(valueMs: number, showSign = false): string {
  const sign = valueMs < 0 ? '-' : showSign && valueMs > 0 ? '+' : '';
  const totalSeconds = Math.floor(Math.abs(valueMs) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function summarizeDay(
  date: string,
  allPunches: Punch[],
  settings: JornadaSettings,
  now: Date = new Date(),
): DaySummary {
  const punches = allPunches
    .filter((punch) => dayKey(punch.timestamp) === date)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const targetMs = settings.targetMinutes * MINUTE_MS;
  const breakTargetMs = settings.breakMinutes * MINUTE_MS;
  const isWorking = punches.length % 2 === 1;
  const isToday = date === dayKey(now);
  let workedMs = 0;
  let breakMs = 0;

  for (let index = 0; index < punches.length; index += 2) {
    const start = dayjs(punches[index].timestamp).valueOf();
    const finished = punches[index + 1];
    const end = finished
      ? dayjs(finished.timestamp).valueOf()
      : isToday
        ? now.getTime()
        : start;
    workedMs += Math.max(end - start, 0);
  }

  for (let index = 1; index < punches.length - 1; index += 2) {
    const start = dayjs(punches[index].timestamp).valueOf();
    const end = dayjs(punches[index + 1].timestamp).valueOf();
    breakMs += Math.max(end - start, 0);
  }

  const isOnBreak = punches.length === 2 && workedMs < targetMs && isToday;
  const currentBreakMs = isOnBreak
    ? Math.max(now.getTime() - dayjs(punches[punches.length - 1].timestamp).valueOf(), 0)
    : 0;
  const displayedBreakMs = breakMs + currentBreakMs;
  const remainingMs = Math.max(targetMs - workedMs, 0);
  const breakRemainingMs = isOnBreak ? Math.max(breakTargetMs - currentBreakMs, 0) : 0;
  let projectedFinish: Date | null = null;

  if (punches.length > 0 && remainingMs > 0 && isToday) {
    const upcomingPause = punches.length === 1 ? breakTargetMs : breakRemainingMs;
    projectedFinish = new Date(now.getTime() + remainingMs + upcomingPause);
  }

  return {
    date,
    punches,
    workedMs,
    breakMs: displayedBreakMs,
    remainingMs,
    balanceMs: workedMs - targetMs,
    breakRemainingMs,
    isWorking,
    isOnBreak,
    projectedFinish,
  };
}

export function groupDates(punches: Punch[]): string[] {
  return [...new Set(punches.map((punch) => dayKey(punch.timestamp)))].sort().reverse();
}

export function mergeOfficialPunches(fallbackPunches: Punch[], officialPunches: Punch[]): Punch[] {
  const officialDates = new Set(officialPunches.map((punch) => dayKey(punch.timestamp)));
  return [
    ...officialPunches,
    ...fallbackPunches.filter((punch) => !officialDates.has(dayKey(punch.timestamp))),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function replacePunchesForPeriod(
  storedPunches: Punch[],
  officialPunches: Punch[],
  dataIni: string,
  dataFinal: string,
): Punch[] {
  const retained = storedPunches.filter((punch) => {
    const date = dayKey(punch.timestamp);
    return date < dataIni || date > dataFinal;
  });
  const unique = new Map([...retained, ...officialPunches].map((punch) => [punch.id, punch]));
  return [...unique.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function replacePendingDaysForPeriod(
  storedDays: RhidPendingDay[],
  officialDays: RhidPendingDay[],
  dataIni: string,
  dataFinal: string,
): RhidPendingDay[] {
  const retained = storedDays.filter((day) => day.date < dataIni || day.date > dataFinal);
  const unique = new Map([...retained, ...officialDays].map((day) => [day.date, day]));
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function replaceOfficialBalanceDaysForPeriod(
  storedDays: OfficialBalanceDay[],
  officialDays: OfficialBalanceDay[],
  dataIni: string,
  dataFinal: string,
): OfficialBalanceDay[] {
  const retained = storedDays.filter((day) => day.date < dataIni || day.date > dataFinal);
  const unique = new Map([...retained, ...officialDays].map((day) => [day.date, day]));
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function officialBalanceForPeriod(
  officialDays: OfficialBalanceDay[],
  startDate: string,
  endDate: string,
): number | null {
  if (!officialDays.length || startDate > endDate) {
    return null;
  }

  const sorted = [...officialDays]
    .filter((day) => Number.isFinite(day.cumulativeBalanceMinutes))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = [...sorted].reverse().find((day) => day.date <= endDate);
  if (!latest) {
    return null;
  }

  const previous = [...sorted].reverse().find((day) => day.date < startDate);
  return (latest.cumulativeBalanceMinutes - (previous?.cumulativeBalanceMinutes ?? 0)) * MINUTE_MS;
}

export function officialAccumulatedBalanceAt(
  officialDays: OfficialBalanceDay[],
  endDate: string,
): number | null {
  const latest = [...officialDays]
    .filter((day) => Number.isFinite(day.cumulativeBalanceMinutes) && day.date <= endDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return latest ? latest.cumulativeBalanceMinutes * MINUTE_MS : null;
}

export function balancePeriodEndDate(
  summary: Pick<DaySummary, 'date' | 'punches' | 'isWorking' | 'isOnBreak'> | null | undefined,
  referenceDate: string,
  includeToday: boolean,
): string {
  const yesterday = dayjs(referenceDate).subtract(1, 'day').format('YYYY-MM-DD');
  if (
    includeToday
    && summary
    && summary.date === referenceDate
    && summary.punches.length >= STANDARD_DAILY_PUNCH_LIMIT
    && summary.punches.length % 2 === 0
    && !summary.isWorking
    && !summary.isOnBreak
  ) {
    return referenceDate;
  }
  return yesterday;
}

export function automaticLunchReturnControlHiddenForJourney(
  hiddenJourneyKey: string | null,
  accountKey: string,
  date: string,
): boolean {
  return Boolean(accountKey && hiddenJourneyKey === `${accountKey}|${date}`);
}
